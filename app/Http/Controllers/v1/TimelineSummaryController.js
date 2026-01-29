"use strict";

const mongoose = require("mongoose");
const TimelineSummary = mongoose.model("TimelineSummary");
const Case = mongoose.model("Case");
const Session = mongoose.model("Session");
const File = mongoose.model("File");
const caseTimelineCtrl = require("./CaseTimelineController");
const bedrockService = require("../../../Services/BedrockService");

const json = require("../../../Traits/ApiResponser");
const AuditLogService = require("../../../Services/AuditLogService");

let o = {};

o.createTimelineSummary = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const {
      caseId,
      periodStart,
      periodEnd,
      summaryContent,
      summaryText,
      filterCriteria,
    } = req.body;

    // Validate required fields
    if (!caseId || !periodStart || !periodEnd) {
      return json.errorResponse(
        res,
        "caseId, periodStart, and periodEnd are required",
        400,
      );
    }

    if (!summaryContent || !summaryText) {
      return json.errorResponse(
        res,
        "summaryContent and summaryText are required",
        400,
      );
    }

    // Verify the case exists and user has access to it
    const caseData = await Case.findById(caseId);
    if (!caseData) {
      return json.errorResponse(res, "Case not found", 404);
    }

    const user = await mongoose.model("User").findById(userId);
    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(res, "You don't have access to this case", 403);
    }

    // Get all sessions for this case within the period
    const sessions = await Session.find({
      case: caseId,
      sessionDate: {
        $gte: new Date(periodStart),
        $lte: new Date(periodEnd),
      },
    }).select("_id");

    // Get all files for this case
    const files = await File.find({
      case: caseId,
      uploaded_at: {
        $gte: new Date(periodStart),
        $lte: new Date(periodEnd),
      },
    }).select("_id");

    // Get the next version number for this case
    const lastSummary = await TimelineSummary.findOne({ case: caseId })
      .sort({ version: -1 })
      .limit(1);

    const version = lastSummary ? lastSummary.version + 1 : 1;

    // Create timeline summary
    const timelineSummary = new TimelineSummary({
      case: caseId,
      version,
      summaryContent,
      summaryText,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      sessionsIncluded: sessions.map((s) => s._id),
      filesIncluded: files.map((f) => f._id),
      sessionCount: sessions.length,
      fileCount: files.length,
      filterCriteria: filterCriteria || null,
      generatedBy: userId,
      status: "Draft",
    });

    await timelineSummary.save();

    // Populate references
    await timelineSummary.populate([
      { path: "case", select: "displayName" },
      { path: "generatedBy", select: "-password" },
      { path: "sessionsIncluded", select: "sessionNumber sessionDate" },
      { path: "filesIncluded", select: "fileName fileUrl" },
    ]);

    // Create timeline entry
    try {
      await caseTimelineCtrl.createTimelineEntry(
        caseId,
        "timeline_summary",
        timelineSummary._id,
        new Date(),
        userId,
        `Timeline Summary v${version} generated`,
      );
    } catch (timelineErr) {
      console.error("Failed to create timeline entry:", timelineErr);
    }

    await AuditLogService.createLog({
      user,
      action: "CREATE",
      actionCategory: "TIMELINE_SUMMARY",
      resourceType: "TimelineSummary",
      resourceId: timelineSummary._id,
      caseId: timelineSummary.case,
      details: {
        version,
        sessionCount: sessions.length,
        fileCount: files.length,
        createdAt: new Date(),
      },
      req,
    });

    return json.successResponse(
      res,
      {
        message: "Timeline summary created successfully",
        keyName: "timelineSummary",
        data: timelineSummary,
      },
      201,
    );
  } catch (err) {
    console.error("Failed to create timeline summary:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to create timeline summary";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getTimelineSummariesByCase = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { caseId } = req.params;
    const { status } = req.query;

    // Verify the case exists and user has access to it
    const caseData = await Case.findById(caseId);
    if (!caseData) {
      return json.errorResponse(res, "Case not found", 404);
    }

    const user = await mongoose.model("User").findById(userId);
    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(res, "You don't have access to this case", 403);
    }

    // Build filter
    const filter = { case: caseId };
    if (status) filter.status = status;

    const summaries = await TimelineSummary.find(filter)
      .populate("case", "displayName")
      .populate("generatedBy", "-password")
      .populate("approvedBy", "-password")
      .sort({ version: -1 });

    return json.successResponse(
      res,
      {
        message: "Timeline summaries fetched successfully",
        keyName: "summaries",
        data: summaries,
        stats: {
          total: summaries.length,
          draft: summaries.filter((s) => s.status === "Draft").length,
          approved: summaries.filter((s) => s.status === "Approved").length,
        },
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch timeline summaries:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch timeline summaries";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getTimelineSummaryById = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;

    const summary = await TimelineSummary.findById(id)
      .populate("case", "displayName assignedTo")
      .populate("generatedBy", "-password")
      .populate("approvedBy", "-password")
      .populate("sessionsIncluded", "sessionNumber sessionDate status")
      .populate("filesIncluded", "fileName fileUrl mimeType");

    if (!summary) {
      return json.errorResponse(res, "Timeline summary not found", 404);
    }

    // Check if user has access
    const user = await mongoose.model("User").findById(userId);
    if (
      summary.case.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "You don't have access to this timeline summary",
        403,
      );
    }
    ("2026-01-16T14:18:04.271Z");

    return json.successResponse(
      res,
      {
        message: "Timeline summary fetched successfully",
        keyName: "summary",
        data: summary,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch timeline summary:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch timeline summary";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.updateTimelineSummary = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;
    const { summaryContent, summaryText, status } = req.body;

    const summary = await TimelineSummary.findById(id).populate("case");
    if (!summary) {
      return json.errorResponse(res, "Timeline summary not found", 404);
    }

    // Check if locked
    if (summary.locked) {
      return json.errorResponse(
        res,
        "This timeline summary is locked and cannot be edited",
        403,
      );
    }

    // Check if user has access
    const user = await mongoose.model("User").findById(userId);
    if (
      summary.case.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "You don't have access to this timeline summary",
        403,
      );
    }

    // Update fields
    if (summaryContent) summary.summaryContent = summaryContent;
    if (summaryText) summary.summaryText = summaryText;
    if (status) summary.status = status;

    await summary.save();
    await summary.populate([
      { path: "case", select: "displayName" },
      { path: "generatedBy", select: "-password" },
      { path: "approvedBy", select: "-password" },
    ]);

    await AuditLogService.createLog({
      user,
      action: "UPDATE",
      actionCategory: "TIMELINE_SUMMARY",
      resourceType: "TimelineSummary",
      resourceId: summary._id,
      caseId: summary.case._id,
      details: {
        updatedFields: [],
        newStatus: summary.status,
        updatedAt: new Date(),
      },
      req,
    });

    return json.successResponse(
      res,
      {
        message: "Timeline summary updated successfully",
        keyName: "summary",
        data: summary,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to update timeline summary:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to update timeline summary";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.approveTimelineSummary = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;

    const summary = await TimelineSummary.findById(id).populate("case");
    if (!summary) {
      return json.errorResponse(res, "Timeline summary not found", 404);
    }

    // Check if user has access
    const user = await mongoose.model("User").findById(userId);
    if (
      summary.case.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "You don't have access to this timeline summary",
        403,
      );
    }

    summary.status = "Approved";
    summary.approvedBy = userId;
    summary.approvedAt = new Date();
    summary.locked = true;

    await summary.save();
    await summary.populate([
      { path: "case", select: "displayName" },
      { path: "generatedBy", select: "-password" },
      { path: "approvedBy", select: "-password" },
    ]);

    await AuditLogService.createLog({
      user,
      action: "APPROVE",
      actionCategory: "TIMELINE_SUMMARY",
      resourceType: "TimelineSummary",
      resourceId: summary._id,
      caseId: summary.case._id,
      details: {
        approvedAt: new Date(),
        approvedBy: user.name,
        locked: true,
      },
      req,
    });

    return json.successResponse(
      res,
      {
        message: "Timeline summary approved successfully",
        keyName: "summary",
        data: summary,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to approve timeline summary:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to approve timeline summary";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.deleteTimelineSummary = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;

    const summary = await TimelineSummary.findById(id).populate("case");
    if (!summary) {
      return json.errorResponse(res, "Timeline summary not found", 404);
    }

    // Check if locked
    if (summary.locked) {
      return json.errorResponse(
        res,
        "This timeline summary is locked and cannot be deleted",
        403,
      );
    }

    // Check if user has access
    const user = await mongoose.model("User").findById(userId);
    if (
      summary.case.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "You don't have access to this timeline summary",
        403,
      );
    }

    await TimelineSummary.findByIdAndDelete(id);

    await AuditLogService.createLog({
      user,
      action: "DELETE",
      actionCategory: "TIMELINE_SUMMARY",
      resourceType: "TimelineSummary",
      resourceId: id,
      caseId: summary.case._id,
      details: {
        deletedAt: new Date(),
        version: summary.version,
      },
      req,
    });

    return json.successResponse(
      res,
      {
        message: "Timeline summary deleted successfully",
        keyName: "data",
        data: { id },
      },
      200,
    );
  } catch (err) {
    console.error("Failed to delete timeline summary:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to delete timeline summary";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getCaseDataForSummary = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { caseId } = req.params;
    const { periodStart, periodEnd } = req.query;

    // Verify the case exists and user has access to it
    const caseData = await Case.findById(caseId);
    if (!caseData) {
      return json.errorResponse(res, "Case not found", 404);
    }

    const user = await mongoose.model("User").findById(userId);
    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(res, "You don't have access to this case", 403);
    }

    // Build date filter if period is provided
    const dateFilter = {};
    if (periodStart && periodEnd) {
      dateFilter.sessionDate = {
        $gte: new Date(periodStart),
        $lte: new Date(periodEnd),
      };
    }

    // Get all sessions for this case
    const sessions = await Session.find({
      case: caseId,
      ...dateFilter,
    })
      .populate("createdBy", "name email")
      .sort({ sessionNumber: 1 });

    // Enhance sessions with transcripts and SOAP notes
    const Transcript = mongoose.model("Transcript");
    const SoapNote = mongoose.model("Soap");

    const enrichedSessions = await Promise.all(
      sessions.map(async (session) => {
        const sessionObj = session.toObject();

        // Fetch transcript for this session
        try {
          const transcript = await Transcript.findOne(
            { session: session._id },
            { rawText: 1, segments: 1, wordCount: 1, duration: 1 },
          );
          sessionObj.transcript = transcript || null;
        } catch (transcriptErr) {
          console.error(
            `Failed to fetch transcript for session ${session._id}:`,
            transcriptErr,
          );
          sessionObj.transcript = null;
        }

        // Fetch latest SOAP note for this session
        try {
          const soapNote = await SoapNote.findOne(
            { session: session._id },
            { content: 1, contentText: 1, status: 1, version: 1, createdAt: 1 },
          ).sort({ version: -1 });
          sessionObj.soapNote = soapNote || null;
        } catch (soapErr) {
          console.error(
            `Failed to fetch SOAP note for session ${session._id}:`,
            soapErr,
          );
          sessionObj.soapNote = null;
        }

        return sessionObj;
      }),
    );

    // Get all files for this case
    const fileFilter = { case: caseId };
    if (periodStart && periodEnd) {
      fileFilter.uploaded_at = {
        $gte: new Date(periodStart),
        $lte: new Date(periodEnd),
      };
    }

    const files = await File.find(fileFilter)
      .populate("uploadedBy", "name email")
      .sort({ uploaded_at: -1 });

    // Get existing timeline summaries
    const existingSummaries = await TimelineSummary.find({ case: caseId })
      .populate("generatedBy", "name email")
      .sort({ version: -1 });

    return json.successResponse(
      res,
      {
        message: "Case data fetched successfully for summary generation",
        data: {
          case: caseData,
          sessions: enrichedSessions,
          files,
          existingSummaries,
          sessionCount: enrichedSessions.length,
          fileCount: files.length,
          summaryCount: existingSummaries.length,
          enrichmentInfo: {
            sessionsWithTranscripts: enrichedSessions.filter(
              (s) => s.transcript,
            ).length,
            sessionsWithSoapNotes: enrichedSessions.filter((s) => s.soapNote)
              .length,
          },
        },
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch case data:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch case data";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.generateTimelineSummaryWithAI = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { caseId, periodStart, periodEnd } = req.body;

    // Validate required fields
    if (!caseId || !periodStart || !periodEnd) {
      return json.errorResponse(
        res,
        "caseId, periodStart, and periodEnd are required",
        400,
      );
    }

    // Verify the case exists and user has access to it
    const caseData = await Case.findById(caseId);
    if (!caseData) {
      return json.errorResponse(res, "Case not found", 404);
    }

    const user = await mongoose.model("User").findById(userId);
    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(res, "You don't have access to this case", 403);
    }

    // Build date filter
    const dateFilter = {
      sessionDate: {
        $gte: new Date(periodStart),
        $lte: new Date(periodEnd),
      },
    };

    // Get all sessions for this case within the period
    const sessions = await Session.find({
      case: caseId,
      ...dateFilter,
    })
      .populate("createdBy", "name email")
      .sort({ sessionNumber: 1 });

    if (sessions.length === 0) {
      return json.errorResponse(
        res,
        "No sessions found in the specified period",
        400,
      );
    }

    // Enhance sessions with transcripts and SOAP notes
    const Transcript = mongoose.model("Transcript");
    const SoapNote = mongoose.model("Soap");

    const enrichedSessions = await Promise.all(
      sessions.map(async (session) => {
        const sessionObj = session.toObject();

        // Fetch transcript for this session
        try {
          const transcript = await Transcript.findOne(
            { session: session._id },
            { rawText: 1, segments: 1, wordCount: 1, duration: 1 },
          );
          sessionObj.transcript = transcript || null;
        } catch (transcriptErr) {
          console.error(
            `Failed to fetch transcript for session ${session._id}:`,
            transcriptErr,
          );
          sessionObj.transcript = null;
        }

        // Fetch latest SOAP note for this session
        try {
          const soapNote = await SoapNote.findOne(
            { session: session._id },
            { content: 1, contentText: 1, status: 1, version: 1, createdAt: 1 },
          ).sort({ version: -1 });
          sessionObj.soapNote = soapNote || null;
        } catch (soapErr) {
          console.error(
            `Failed to fetch SOAP note for session ${session._id}:`,
            soapErr,
          );
          sessionObj.soapNote = null;
        }

        return sessionObj;
      }),
    );

    // Get all files for this case within the period
    const files = await File.find({
      case: caseId,
      uploaded_at: {
        $gte: new Date(periodStart),
        $lte: new Date(periodEnd),
      },
    })
      .populate("uploadedBy", "name email")
      .sort({ uploaded_at: -1 });

    // Get existing timeline summaries for context
    const existingSummaries = await TimelineSummary.find({ case: caseId })
      .sort({ version: -1 })
      .limit(1);

    // Call Bedrock to generate summary
    console.log("[TimelineSummary AI] Generating summary with AWS Bedrock...");
    const aiGenerated = await bedrockService.generateTimelineSummary({
      caseName: caseData.displayName,
      caseData,
      enrichedSessions,
      files,
      existingSummaries,
      periodStart,
      periodEnd,
    });

    // Get the next version number for this case
    const lastSummary = await TimelineSummary.findOne({ case: caseId })
      .sort({ version: -1 })
      .limit(1);

    const version = lastSummary ? lastSummary.version + 1 : 1;

    // Create timeline summary record
    const timelineSummary = new TimelineSummary({
      case: caseId,
      version,
      summaryContent: aiGenerated.summaryContent,
      summaryText: aiGenerated.summaryText,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      sessionsIncluded: enrichedSessions.map((s) => s._id),
      filesIncluded: files.map((f) => f._id),
      sessionCount: enrichedSessions.length,
      fileCount: files.length,
      filterCriteria: null,
      generatedBy: userId,
      status: "Draft",
      modelUsed: aiGenerated.modelId,
    });

    await timelineSummary.save();

    // Populate references
    await timelineSummary.populate([
      { path: "case", select: "displayName" },
      { path: "generatedBy", select: "-password" },
      { path: "sessionsIncluded", select: "sessionNumber sessionDate" },
      { path: "filesIncluded", select: "fileName fileUrl" },
    ]);

    // Create timeline entry
    try {
      await caseTimelineCtrl.createTimelineEntry(
        caseId,
        "timeline_summary",
        timelineSummary._id,
        new Date(),
        userId,
        `Timeline Summary v${version} AI-generated`,
      );
    } catch (timelineErr) {
      console.error("Failed to create timeline entry:", timelineErr);
    }

    console.log(
      "[TimelineSummary AI] Summary generated successfully, version:",
      version,
    );

    await AuditLogService.createLog({
      user,
      action: "GENERATE",
      actionCategory: "TIMELINE_SUMMARY",
      resourceType: "TimelineSummary",
      resourceId: timelineSummary._id,
      caseId: timelineSummary.case,
      details: {
        version,
        sessionCount: enrichedSessions.length,
        fileCount: files.length,
        modelUsed: aiGenerated.modelId,
        generatedAt: new Date(),
      },
      req,
    });

    return json.successResponse(
      res,
      {
        message: "Timeline summary generated successfully with AI",
        keyName: "timelineSummary",
        data: timelineSummary,
      },
      201,
    );
  } catch (err) {
    console.error("Failed to generate timeline summary with AI:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to generate timeline summary";
    return json.errorResponse(res, errorMessage, 500);
  }
};

module.exports = o;
