"use strict";

const mongoose = require("mongoose");
const Soap = mongoose.model("Soap");
const Session = mongoose.model("Session");
const Case = mongoose.model("Case");
const Transcript = mongoose.model("Transcript");

const json = require("../../../Traits/ApiResponser");
const bedrockService = require("../../../Services/BedrockService");
const DataRetentionService = require("../../../Services/DataRetentionService");
const AuditLogService = require("../../../Services/AuditLogService");

let o = {};

const buildHttpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const ensureSessionAccess = async (sessionId, userId) => {
  const session = await Session.findById(sessionId).populate("case");
  if (!session) {
    throw buildHttpError("Session not found", 404);
  }

  const caseData = session.case;
  const user = await mongoose.model("User").findById(userId);

  if (
    caseData.assignedTo.toString() !== userId.toString() &&
    user.role !== "admin"
  ) {
    throw buildHttpError(
      "Access denied. You are not assigned to this case.",
      403,
    );
  }

  return { session, caseData };
};

const createSoapNoteRecord = async ({
  session,
  caseData,
  framework,
  content,
  contentText,
  generatedBy,
  aiModelVersion,
  piiMasked,
  maskingMetadata,
}) => {
  const lastSoapNote = await Soap.findOne({ session: session._id })
    .sort({ version: -1 })
    .limit(1);

  const version = lastSoapNote ? lastSoapNote.version + 1 : 1;

  const soapNote = new Soap({
    session: session._id,
    version,
    framework,
    content,
    contentText,
    generatedBy: generatedBy || "AI",
    aiModelVersion,
    piiMasked: piiMasked !== undefined ? piiMasked : false,
    maskingMetadata,
    status: "Draft",
  });

  await soapNote.save();

  if (version === 1) {
    caseData.notesCount = (caseData.notesCount || 0) + 1;
    await caseData.save();
  }

  await soapNote.populate([
    {
      path: "session",
      select: "sessionNumber sessionDate case",
      populate: { path: "case", select: "displayName" },
    },
  ]);

  return soapNote;
};

o.createSoapNote = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const {
      sessionId,
      framework,
      content,
      contentText,
      generatedBy,
      aiModelVersion,
      piiMasked,
      maskingMetadata,
    } = req.body;

    if (!sessionId || !framework || !content || !contentText) {
      return json.errorResponse(
        res,
        "Session ID, framework, content, and contentText are required",
        400,
      );
    }

    const { session, caseData } = await ensureSessionAccess(sessionId, userId);

    const soapNote = await createSoapNoteRecord({
      session,
      caseData,
      framework,
      content,
      contentText,
      generatedBy,
      aiModelVersion,
      piiMasked,
      maskingMetadata,
    });

    const user = await mongoose.model("User").findById(userId);
    await AuditLogService.createLog({
      user,
      action: "CREATE",
      actionCategory: "SOAP",
      resourceType: "Soap",
      resourceId: soapNote._id,
      caseId: session.case,
      sessionId: session._id,
      details: {
        framework: soapNote.framework,
        version: soapNote.version,
        createdAt: new Date(),
      },
      req,
    });

    return json.successResponse(
      res,
      {
        message: "SOAP note created successfully",
        keyName: "soapNote",
        data: soapNote,
      },
      201,
    );
  } catch (err) {
    console.error("Failed to create SOAP note:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to create SOAP note";
    return json.errorResponse(res, errorMessage, err.statusCode || 500);
  }
};

o.generateSoapNoteFromTranscript = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const {
      sessionId,
      transcriptId,
      transcriptText,
      framework = "SOAP",
      temperature,
      maxTokens,
      piiMasked,
      maskingMetadata,
    } = req.body;

    if (!sessionId) {
      return json.errorResponse(res, "sessionId is required", 400);
    }

    const { session, caseData } = await ensureSessionAccess(sessionId, userId);

    let resolvedTranscript = transcriptText;

    if (!resolvedTranscript && transcriptId) {
      const transcriptDoc = await Transcript.findById(transcriptId);
      if (!transcriptDoc) {
        return json.errorResponse(res, "Transcript not found", 404);
      }

      if (transcriptDoc.session.toString() !== sessionId.toString()) {
        return json.errorResponse(
          res,
          "Transcript does not belong to this session",
          400,
        );
      }

      resolvedTranscript = transcriptDoc.editedText || transcriptDoc.rawText;
    }

    if (!resolvedTranscript) {
      const transcriptDoc = await Transcript.findOne({ session: sessionId });
      resolvedTranscript = transcriptDoc?.editedText || transcriptDoc?.rawText;
    }

    if (!resolvedTranscript) {
      return json.errorResponse(
        res,
        "Transcript text is required to generate a SOAP note",
        400,
      );
    }

    const aiResult = await bedrockService.generateSoapNoteFromTranscript({
      transcriptText: resolvedTranscript,
      framework,
      temperature: temperature !== undefined ? temperature : 0.2,
      maxTokens: maxTokens !== undefined ? maxTokens : 1200,
      caseName: caseData?.displayName || "Unknown Case",
      sessionDate: session.sessionDate,
      language: session.language || "english",
    });

    const soapNote = await createSoapNoteRecord({
      session,
      caseData,
      framework,
      content: aiResult.content,
      contentText: aiResult.contentText,
      generatedBy: "AI",
      aiModelVersion: aiResult.modelId,
      piiMasked:
        piiMasked !== undefined ? piiMasked : session.piiMaskingEnabled,
      maskingMetadata,
    });

    const user = await mongoose.model("User").findById(userId);
    await AuditLogService.createLog({
      user,
      action: "GENERATE",
      actionCategory: "SOAP",
      resourceType: "Soap",
      resourceId: soapNote._id,
      caseId: session.case,
      sessionId: session._id,
      details: {
        generatedFrom: "transcript",
        framework: soapNote.framework,
        version: soapNote.version,
        modelId: aiResult.modelId,
        generatedAt: new Date(),
      },
      req,
    });

    return json.successResponse(
      res,
      {
        message: "SOAP note generated successfully",
        keyName: "soapNote",
        data: soapNote,
        stats: {
          modelId: aiResult.modelId,
        },
      },
      201,
    );
  } catch (err) {
    console.error("Failed to generate SOAP note:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to generate SOAP note";
    return json.errorResponse(res, errorMessage, err.statusCode || 500);
  }
};

o.updateSoapNote = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;
    const { content, contentText, piiMasked, maskingMetadata, status } =
      req.body;

    const soapNote = await Soap.findById(id).populate({
      path: "session",
      populate: { path: "case" },
    });

    if (!soapNote) {
      return json.errorResponse(res, "SOAP note not found", 404);
    }

    // Check if note is locked (approved)
    if (soapNote.status === "Approved") {
      return json.errorResponse(
        res,
        "Cannot edit an approved SOAP note. Create a new version instead.",
        400,
      );
    }

    // Check access
    const caseData = soapNote.session.case;
    const user = await mongoose.model("User").findById(userId);

    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "Access denied. You are not assigned to this case.",
        403,
      );
    }

    // Update fields if provided
    if (content) soapNote.content = content;
    if (contentText) soapNote.contentText = contentText;
    if (piiMasked !== undefined) soapNote.piiMasked = piiMasked;
    if (maskingMetadata) soapNote.maskingMetadata = maskingMetadata;
    if (status && ["Draft", "Reviewed"].includes(status)) {
      soapNote.status = status;
    }

    await soapNote.save();
    await soapNote.populate([
      {
        path: "session",
        select: "sessionNumber sessionDate case",
        populate: { path: "case", select: "displayName" },
      },
      { path: "approvedBy", select: "-password" },
    ]);

    await AuditLogService.createLog({
      user,
      action: "UPDATE",
      actionCategory: "SOAP",
      resourceType: "Soap",
      resourceId: soapNote._id,
      caseId: soapNote.session.case,
      sessionId: soapNote.session,
      details: {
        updatedFields: Object.keys(req.body),
        newStatus: soapNote.status,
        updatedAt: new Date(),
      },
      req,
    });

    return json.successResponse(
      res,
      {
        message: "SOAP note updated successfully",
        keyName: "soapNote",
        data: soapNote,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to update SOAP note:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to update SOAP note";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.approveSoapNote = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;

    const soapNote = await Soap.findById(id).populate({
      path: "session",
      populate: { path: "case" },
    });

    if (!soapNote) {
      return json.errorResponse(res, "SOAP note not found", 404);
    }

    // Check if already approved
    if (soapNote.status === "Approved") {
      return json.errorResponse(res, "SOAP note is already approved", 400);
    }

    // Check access
    const caseData = soapNote.session.case;
    const user = await mongoose.model("User").findById(userId);

    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "Access denied. You are not assigned to this case.",
        403,
      );
    }

    // Approve the note
    soapNote.status = "Approved";
    soapNote.approvedBy = userId;
    soapNote.approvedAt = new Date();

    await soapNote.save();

    // Schedule data retention: delete audio/transcript 7 days after approval
    try {
      await DataRetentionService.schedulePostApprovalDeletion(
        soapNote.session._id,
      );
      console.log(
        `[SoapController] Scheduled data retention for session ${soapNote.session._id}`,
      );
    } catch (retentionError) {
      // Log error but don't fail the approval
      console.error(
        "[SoapController] Failed to schedule data retention:",
        retentionError,
      );
    }

    await soapNote.populate([
      {
        path: "session",
        select: "sessionNumber sessionDate case",
        populate: { path: "case", select: "displayName" },
      },
      { path: "approvedBy", select: "-password" },
    ]);

    await AuditLogService.createLog({
      user,
      action: "APPROVE",
      actionCategory: "SOAP",
      resourceType: "Soap",
      resourceId: soapNote._id,
      caseId: soapNote.session.case,
      sessionId: soapNote.session,
      details: {
        approvedAt: soapNote.approvedAt,
        approvedBy: user.name,
      },
      req,
    });

    return json.successResponse(
      res,
      {
        message: "SOAP note approved successfully",
        keyName: "soapNote",
        data: soapNote,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to approve SOAP note:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to approve SOAP note";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getSoapNotesBySession = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { sessionId } = req.params;
    const { status, framework } = req.query;

    // Verify session exists and user has access
    const session = await Session.findById(sessionId).populate("case");
    if (!session) {
      return json.errorResponse(res, "Session not found", 404);
    }

    const caseData = session.case;
    const user = await mongoose.model("User").findById(userId);

    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "Access denied. You are not assigned to this case.",
        403,
      );
    }

    // Build filter
    const filter = { session: sessionId };
    if (status) filter.status = status;
    if (framework) filter.framework = framework;

    const soapNotes = await Soap.find(filter)
      .populate([
        {
          path: "session",
          select: "sessionNumber sessionDate case",
          populate: { path: "case", select: "displayName" },
        },
        { path: "approvedBy", select: "-password" },
      ])
      .sort({ version: -1 });

    return json.successResponse(
      res,
      {
        message: "SOAP notes fetched successfully",
        keyName: "soapNotes",
        data: soapNotes,
        stats: {
          total: soapNotes.length,
          draft: soapNotes.filter((n) => n.status === "Draft").length,
          reviewed: soapNotes.filter((n) => n.status === "Reviewed").length,
          approved: soapNotes.filter((n) => n.status === "Approved").length,
        },
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch SOAP notes:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch SOAP notes";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getSoapNoteById = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;

    const soapNote = await Soap.findById(id).populate([
      {
        path: "session",
        select: "sessionNumber sessionDate case",
        populate: { path: "case", select: "displayName" },
      },
      { path: "approvedBy", select: "-password" },
    ]);

    if (!soapNote) {
      return json.errorResponse(res, "SOAP note not found", 404);
    }

    // Check access
    const caseData = soapNote.session.case;
    const user = await mongoose.model("User").findById(userId);

    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "Access denied. You are not assigned to this case.",
        403,
      );
    }

    return json.successResponse(
      res,
      {
        message: "SOAP note fetched successfully",
        keyName: "soapNote",
        data: soapNote,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch SOAP note:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch SOAP note";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.deleteSoapNote = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;

    const soapNote = await Soap.findById(id).populate({
      path: "session",
      populate: { path: "case" },
    });

    if (!soapNote) {
      return json.errorResponse(res, "SOAP note not found", 404);
    }

    // Check if note is approved
    if (soapNote.status === "Approved") {
      return json.errorResponse(
        res,
        "Cannot delete an approved SOAP note",
        400,
      );
    }

    // Check access (only admin or assigned user can delete)
    const caseData = soapNote.session.case;
    const user = await mongoose.model("User").findById(userId);

    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "Access denied. You are not assigned to this case.",
        403,
      );
    }

    // Check if this is version 1, then decrement case notes count
    if (soapNote.version === 1) {
      const otherVersions = await Soap.countDocuments({
        session: soapNote.session._id,
        _id: { $ne: soapNote._id },
      });

      if (otherVersions === 0) {
        caseData.notesCount = Math.max((caseData.notesCount || 1) - 1, 0);
        await caseData.save();
      }
    }

    await AuditLogService.createLog({
      user,
      action: "DELETE",
      actionCategory: "SOAP",
      resourceType: "Soap",
      resourceId: soapNote._id,
      caseId: soapNote.session.case,
      sessionId: soapNote.session,
      details: {
        framework: soapNote.framework,
        version: soapNote.version,
        deletedAt: new Date(),
      },
      req,
    });

    await Soap.findByIdAndDelete(id);

    return json.successResponse(
      res,
      {
        message: "SOAP note deleted successfully",
        keyName: "data",
        data: { id },
      },
      200,
    );
  } catch (err) {
    console.error("Failed to delete SOAP note:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to delete SOAP note";
    return json.errorResponse(res, errorMessage, 500);
  }
};

module.exports = o;
