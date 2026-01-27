"use strict";

const mongoose = require("mongoose");
const Case = mongoose.model("Case");
const User = mongoose.model("User");
const Session = mongoose.model("Session");
const File = mongoose.model("File");
const TimelineSummary = mongoose.model("TimelineSummary");
const Transcript = mongoose.model("Transcript");
const Soap = mongoose.model("Soap");

const json = require("../../../Traits/ApiResponser");
const AuditLogService = require("../../../Services/AuditLogService");

const VALID_STATUSES = ["Active", "Closed", "OnHold", "Unapporved"];

// Generate the next internal reference like CASE-YYYY-XXX
const generateInternalRef = async () => {
  const year = new Date().getFullYear();
  const lastCase = await Case.findOne({
    internalRef: new RegExp(`^CASE-${year}-`),
  })
    .sort({ internalRef: -1 })
    .limit(1);

  let caseNumber = 1;
  if (lastCase && lastCase.internalRef) {
    const lastNumber = parseInt(lastCase.internalRef.split("-")[2]);
    caseNumber = Number.isNaN(lastNumber) ? 1 : lastNumber + 1;
  }

  return `CASE-${year}-${String(caseNumber).padStart(3, "0")}`;
};

let o = {};

/**
 * Export a case bundle as JSON attachment (placeholder for other formats).
 * Query params:
 *  - format: json|pdf|docx|zip (json supported; others return 400 for now)
 */
o.exportCase = async (req, res, next) => {
  try {
    const { caseId } = req.params;
    const { _id: userId } = req.decoded;

    const {
      format = "json",
      exportType = "full-case",
      contentToInclude = "",
      sessionIds = "",
      startDate,
      endDate,
      privacyOptions = "",
    } = req.query;

    const selectedFormat = String(format).toLowerCase();
    if (selectedFormat !== "json") {
      return json.errorResponse(
        res,
        "Only JSON export is supported at the moment",
        400,
      );
    }

    const parseCsvParam = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value.filter(Boolean);
      return String(value)
        .split(",")
        .map((i) => i.trim())
        .filter(Boolean);
    };

    const includeList = parseCsvParam(contentToInclude);
    const privacyList = parseCsvParam(privacyOptions);
    const selectedSessionIds = parseCsvParam(sessionIds);

    const startDateObj = startDate ? new Date(startDate) : null;
    const endDateObj = endDate ? new Date(endDate) : null;
    if (startDateObj && Number.isNaN(startDateObj.getTime())) {
      return json.errorResponse(res, "Invalid startDate", 400);
    }
    if (endDateObj && Number.isNaN(endDateObj.getTime())) {
      return json.errorResponse(res, "Invalid endDate", 400);
    }
    if (startDateObj && endDateObj && startDateObj > endDateObj) {
      return json.errorResponse(res, "startDate must be before endDate", 400);
    }

    const caseData = await Case.findById(caseId)
      .populate("assignedTo", "name email role")
      .populate("createdBy", "name email role");
    if (!caseData) {
      return json.errorResponse(res, "Case not found", 404);
    }

    const user = await User.findById(userId);
    const assignedId =
      (caseData.assignedTo && caseData.assignedTo._id
        ? caseData.assignedTo._id.toString()
        : caseData.assignedTo?.toString?.()) || null;
    const isAdmin = user?.role === "admin";
    if (!isAdmin && assignedId !== userId.toString()) {
      return json.errorResponse(res, "You don't have access to this case", 403);
    }

    const sessionQuery = { case: caseId };
    if (startDateObj || endDateObj) {
      sessionQuery.sessionDate = {};
      if (startDateObj) sessionQuery.sessionDate.$gte = startDateObj;
      if (endDateObj) sessionQuery.sessionDate.$lte = endDateObj;
    }
    if (exportType === "single-sessions" && selectedSessionIds.length) {
      sessionQuery._id = { $in: selectedSessionIds };
    }

    const fileQuery = { case: caseId };
    if (startDateObj || endDateObj) {
      fileQuery.uploaded_at = {};
      if (startDateObj) fileQuery.uploaded_at.$gte = startDateObj;
      if (endDateObj) fileQuery.uploaded_at.$lte = endDateObj;
    }

    const summaryQuery = { case: caseId };
    if (startDateObj || endDateObj) {
      const summaryDateFilters = [];
      if (startDateObj) {
        summaryDateFilters.push({ periodStart: { $gte: startDateObj } });
      }
      if (endDateObj) {
        summaryDateFilters.push({ periodEnd: { $lte: endDateObj } });
      }
      if (summaryDateFilters.length) summaryQuery.$or = summaryDateFilters;
    }

    const [sessions, files, summaries] = await Promise.all([
      Session.find(sessionQuery)
        .populate("createdBy", "name email role")
        .sort({ sessionNumber: 1 })
        .lean(),
      File.find(fileQuery)
        .populate("uploadedBy", "name email role")
        .sort({ uploaded_at: -1 })
        .lean(),
      TimelineSummary.find(summaryQuery)
        .populate("generatedBy", "name email role")
        .populate("approvedBy", "name email role")
        .sort({ version: -1 })
        .lean(),
    ]);

    // Apply sensible defaults when no specific content list is provided
    let effectiveInclude = [...includeList];
    if (!effectiveInclude.length) {
      if (exportType === "single-sessions") {
        effectiveInclude = ["case-info", "sessions", "transcripts"];
      } else if (exportType === "timeline-summary") {
        effectiveInclude = ["case-info", "timeline-summary"];
      }
    }

    const includeCaseInfo =
      !effectiveInclude.length || effectiveInclude.includes("case-info");
    const includeSessions =
      !effectiveInclude.length ||
      effectiveInclude.includes("session-notes") ||
      effectiveInclude.includes("sessions") ||
      exportType === "single-sessions";
    const includeFiles =
      !effectiveInclude.length || effectiveInclude.includes("uploaded-files");
    const includeSummaries =
      !effectiveInclude.length || effectiveInclude.includes("timeline-summary");
    const includeTranscripts =
      !effectiveInclude.length || effectiveInclude.includes("transcripts");
    const includeSoapNotes =
      !effectiveInclude.length ||
      effectiveInclude.includes("session-notes") ||
      exportType === "single-sessions";

    const sessionIdsToInclude = sessions.map((s) => s._id);

    let transcripts = [];
    if (includeTranscripts) {
      transcripts = await Transcript.find({
        session: { $in: sessionIdsToInclude },
      })
        .populate("session", "sessionNumber sessionDate status")
        .lean();
    }

    let soapNotes = [];
    if (includeSoapNotes) {
      soapNotes = await Soap.find({ session: { $in: sessionIdsToInclude } })
        .populate("session", "sessionNumber sessionDate status")
        .lean();
    }

    const payload = {
      meta: {
        exportedAt: new Date().toISOString(),
        format: selectedFormat,
        exportType,
        filters: {
          startDate: startDateObj || undefined,
          endDate: endDateObj || undefined,
          contentToInclude: includeList,
          sessionIds: selectedSessionIds,
          privacyOptions: privacyList,
        },
        counts: {
          sessions: includeSessions ? sessions.length : 0,
          files: includeFiles ? files.length : 0,
          timelineSummaries: includeSummaries ? summaries.length : 0,
          transcripts: includeTranscripts ? transcripts.length : 0,
          soapNotes: includeSoapNotes ? soapNotes.length : 0,
        },
      },
    };

    if (includeCaseInfo) payload.case = caseData.toObject();
    if (includeSessions) payload.sessions = sessions;
    if (includeFiles) payload.files = files;
    if (includeSummaries) payload.timelineSummaries = summaries;
    if (includeTranscripts) payload.transcripts = transcripts;
    if (includeSoapNotes) payload.soapNotes = soapNotes;

    const filename = `${caseData.internalRef || "case"}-export.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await AuditLogService.createLog({
      user,
      action: "EXPORT",
      actionCategory: "CASE",
      resourceType: "Case",
      resourceId: req.params.caseId,
      caseId: req.params.caseId,
      details: {
        exportFormat: "JSON",
        exportedAt: new Date(),
      },
      req,
    });

    return res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error("Failed to export case:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to export case data";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.createCase = async (req, res, next) => {
  try {
    const { displayName, assignedTo, tags, status } = req.body;
    const { _id: adminId } = req.decoded;

    // Validate required fields
    if (!displayName || !assignedTo) {
      return json.errorResponse(
        res,
        "displayName and assignedTo are required",
        400,
      );
    }

    // Validate status if provided
    if (status && !VALID_STATUSES.includes(status)) {
      return json.errorResponse(
        res,
        `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
        400,
      );
    }

    // Verify the assigned user exists
    const assignedUser = await User.findById(assignedTo);
    if (!assignedUser) {
      return json.errorResponse(res, "Assigned user not found", 404);
    }

    // Generate internal reference (CASE-YYYY-XXX format)
    const internalRef = await generateInternalRef();

    // Create the case
    const newCase = new Case({
      displayName,
      internalRef,
      assignedTo,
      createdBy: adminId,
      tags: tags || [],
      status: status || "Active",
    });

    await newCase.save();

    const adminUser = await mongoose.model("User").findById(adminId);
    await AuditLogService.createLog({
      user: adminUser,
      action: "CREATE",
      actionCategory: "CASE",
      resourceType: "Case",
      resourceId: newCase._id,
      caseId: newCase._id,
      details: {
        displayName: newCase.displayName,
        internalRef: newCase.internalRef,
        assignedTo: assignedUser.email,
      },
      req,
    });

    // Populate assignedTo and createdBy user details
    await newCase.populate([
      { path: "assignedTo", select: "-password" },
      { path: "createdBy", select: "-password" },
    ]);

    return json.successResponse(
      res,
      {
        message: "Case created successfully",
        keyName: "case",
        data: newCase,
      },
      201,
    );
  } catch (err) {
    console.error("Failed to create case:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to create case";
    return json.errorResponse(res, errorMessage, 500);
  }
};

// Practitioners create their own case; always Active and self-assigned
o.createCaseSelf = async (req, res, next) => {
  try {
    const { displayName, tags } = req.body;
    const { _id: userId } = req.decoded;

    if (!displayName) {
      return json.errorResponse(res, "displayName is required", 400);
    }

    const internalRef = await generateInternalRef();

    const newCase = new Case({
      displayName,
      internalRef,
      assignedTo: userId,
      createdBy: userId,
      tags: tags || [],
      status: "Active",
    });

    await newCase.save();

    const user = await mongoose.model("User").findById(userId);
    await AuditLogService.createLog({
      user,
      action: "CREATE",
      actionCategory: "CASE",
      resourceType: "Case",
      resourceId: newCase._id,
      caseId: newCase._id,
      details: {
        displayName: newCase.displayName,
        internalRef: newCase.internalRef,
      },
      req,
    });

    await newCase.populate([
      { path: "assignedTo", select: "-password" },
      { path: "createdBy", select: "-password" },
    ]);

    return json.successResponse(
      res,
      {
        message: "Case created successfully",
        userMessage: "Your case has been created",
        keyName: "case",
        data: newCase,
      },
      201,
    );
  } catch (err) {
    console.error("Failed to create self case:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to create case";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getAllCases = async (req, res, next) => {
  try {
    const { status, assignedTo, page = 1, limit = 10 } = req.query;
    const filter = {};

    // Validate status if provided
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return json.errorResponse(
          res,
          `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
          400,
        );
      }
      filter.status = status;
    }
    if (assignedTo) {
      filter.assignedTo = assignedTo;
    }

    // Get total count for pagination
    const total = await Case.countDocuments(filter);

    // Calculate pagination
    const pagination = json.getPaginationMeta(page, limit, total);

    // Fetch cases with pagination
    const cases = await Case.find(filter)
      .populate("assignedTo", "-password")
      .populate("createdBy", "-password")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Calculate stats
    const stats = {
      active: await Case.countDocuments({ ...filter, status: "Active" }),
      closed: await Case.countDocuments({ ...filter, status: "Closed" }),
      onHold: await Case.countDocuments({ ...filter, status: "OnHold" }),
      unapproved: await Case.countDocuments({
        ...filter,
        status: "Unapporved",
      }),
    };

    return json.successResponse(
      res,
      {
        message: "Cases fetched successfully",
        keyName: "cases",
        data: cases,
        pagination,
        stats,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch cases:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch cases";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getMyCases = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { search, status, sortBy, page = 1, limit = 10 } = req.query;

    // Build filter - always filter by assignedTo current user
    const filter = { assignedTo: userId };

    // Add status filter if provided
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return json.errorResponse(
          res,
          `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
          400,
        );
      }
      filter.status = status;
    }

    // Add search filter if provided (search in displayName and internalRef)
    if (search) {
      filter.$or = [
        { displayName: { $regex: search, $options: "i" } },
        { internalRef: { $regex: search, $options: "i" } },
      ];
    }

    // Determine sort order (default: last updated)
    let sortOption = { updatedAt: -1 };
    if (sortBy === "created") {
      sortOption = { createdAt: -1 };
    } else if (sortBy === "name") {
      sortOption = { displayName: 1 };
    } else if (sortBy === "lastSession") {
      sortOption = { lastSessionAt: -1 };
    }

    // Get total count for pagination
    const total = await Case.countDocuments(filter);

    // Calculate pagination
    const pagination = json.getPaginationMeta(page, limit, total);

    // Fetch cases with pagination
    const cases = await Case.find(filter)
      .populate("assignedTo", "-password")
      .populate("createdBy", "-password")
      .sort(sortOption)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Calculate stats for user's cases
    const stats = {
      active: await Case.countDocuments({
        assignedTo: userId,
        status: "Active",
      }),
      closed: await Case.countDocuments({
        assignedTo: userId,
        status: "Closed",
      }),
      onHold: await Case.countDocuments({
        assignedTo: userId,
        status: "OnHold",
      }),
      unapproved: await Case.countDocuments({
        assignedTo: userId,
        status: "Unapporved",
      }),
    };

    return json.successResponse(
      res,
      {
        message: "Your cases fetched successfully",
        userMessage: "Your cases have been loaded successfully",
        keyName: "cases",
        data: cases,
        pagination,
        stats,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch user cases:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch user cases";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getCaseById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const caseData = await Case.findById(id)
      .populate("assignedTo", "-password")
      .populate("createdBy", "-password");

    if (!caseData) {
      return json.errorResponse(res, "Case not found", 404);
    }

    return json.successResponse(
      res,
      {
        message: "Case fetched successfully",
        keyName: "case",
        data: caseData,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch case:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch case";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.updateCase = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { displayName, assignedTo, tags, status } = req.body;

    const caseData = await Case.findById(id);
    if (!caseData) {
      return json.errorResponse(res, "Case not found", 404);
    }

    // If assignedTo is being updated, verify the user exists
    if (assignedTo && assignedTo !== caseData.assignedTo.toString()) {
      const assignedUser = await User.findById(assignedTo);
      if (!assignedUser) {
        return json.errorResponse(res, "Assigned user not found", 404);
      }
      caseData.assignedTo = assignedTo;
    }

    if (displayName) caseData.displayName = displayName;
    if (tags) caseData.tags = tags;
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return json.errorResponse(
          res,
          `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
          400,
        );
      }
      caseData.status = status;
    }

    await caseData.save();

    const user = await mongoose.model("User").findById(req.decoded._id);
    await AuditLogService.createLog({
      user,
      action: "UPDATE",
      actionCategory: "CASE",
      resourceType: "Case",
      resourceId: caseData._id,
      caseId: caseData._id,
      details: {
        updatedFields: Object.keys(req.body),
        newStatus: caseData.status,
      },
      req,
    });

    await caseData.populate([
      { path: "assignedTo", select: "-password" },
      { path: "createdBy", select: "-password" },
    ]);

    return json.successResponse(
      res,
      {
        message: "Case updated successfully",
        keyName: "case",
        data: caseData,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to update case:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to update case";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.deleteCase = async (req, res, next) => {
  try {
    const { id } = req.params;

    const caseData = await Case.findById(id);
    if (!caseData) {
      return json.errorResponse(res, "Case not found", 404);
    }

    const user = await mongoose.model("User").findById(req.decoded._id);
    await AuditLogService.createLog({
      user,
      action: "DELETE",
      actionCategory: "CASE",
      resourceType: "Case",
      resourceId: req.params.id,
      caseId: req.params.id,
      details: {
        displayName: caseData.displayName,
        internalRef: caseData.internalRef,
        deletedAt: new Date(),
      },
      req,
    });

    await Case.findByIdAndDelete(id);

    return json.successResponse(
      res,
      {
        message: "Case deleted successfully",
        keyName: "data",
        data: { id },
      },
      200,
    );
  } catch (err) {
    console.error("Failed to delete case:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to delete case";
    return json.errorResponse(res, errorMessage, 500);
  }
};

module.exports = o;
