"use strict";

const mongoose = require("mongoose");
const Soap = mongoose.model("Soap");
const Session = mongoose.model("Session");
const Case = mongoose.model("Case");
const Transcript = mongoose.model("Transcript");

const json = require("../../../Traits/ApiResponser");
const bedrockService = require("../../../Services/BedrockService");

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
      populate: { path: "case", select: "displayName internalRef" },
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

      // Use masked version for AI processing if PII masking is enabled
      if (transcriptDoc.piiMaskingEnabled && transcriptDoc.hasPii) {
        resolvedTranscript = transcriptDoc.maskedEditedText || transcriptDoc.maskedText || transcriptDoc.editedText || transcriptDoc.rawText;
        console.log(`[SoapController] Using PII-masked transcript for AI processing`);
      } else {
        resolvedTranscript = transcriptDoc.editedText || transcriptDoc.rawText;
      }
    }

    if (!resolvedTranscript) {
      const transcriptDoc = await Transcript.findOne({ session: sessionId });
      if (transcriptDoc) {
        // Use masked version for AI processing if PII masking is enabled
        if (transcriptDoc.piiMaskingEnabled && transcriptDoc.hasPii) {
          resolvedTranscript = transcriptDoc.maskedEditedText || transcriptDoc.maskedText || transcriptDoc.editedText || transcriptDoc.rawText;
          console.log(`[SoapController] Using PII-masked transcript for AI processing`);
        } else {
          resolvedTranscript = transcriptDoc.editedText || transcriptDoc.rawText;
        }
      }
    }

    if (!resolvedTranscript) {
      return json.errorResponse(
        res,
        "Transcript text is required to generate a SOAP note",
        400,
      );
    }

    // Apply additional PII masking if not already masked and session has PII masking enabled
    let finalTranscriptForAI = resolvedTranscript;
    let piiMaskingApplied = false;
    let piiMaskingMetadata = null;

    if (session.piiMaskingEnabled && !piiMasked) {
      const PiiMaskingService = require("../../../Services/PiiMaskingService");
      const piiMaskingService = new PiiMaskingService();
      
      const maskingResult = piiMaskingService.maskPii(resolvedTranscript, {
        maskNames: true,
        maskNric: true,
        maskPhone: true,
        maskEmail: true,
        maskDates: false, // Keep dates for medical context
        maskAddresses: true,
        maskMedicalIds: true,
        maskFinancial: true,
        preserveLength: false
      });

      if (maskingResult.metadata.maskingApplied) {
        finalTranscriptForAI = maskingResult.maskedText;
        piiMaskingApplied = true;
        piiMaskingMetadata = maskingResult.metadata;
        
        console.log(`[SoapController] Additional PII masking applied before AI processing:`, {
          entitiesCount: maskingResult.metadata.totalEntitiesMasked,
          entitiesByType: maskingResult.metadata.entitiesByType
        });
      }
    }

    const aiResult = await bedrockService.generateSoapNoteFromTranscript({
      transcriptText: finalTranscriptForAI,
      framework,
      temperature: temperature !== undefined ? temperature : 0.2,
      maxTokens: maxTokens !== undefined ? maxTokens : 1200,
      caseName: caseData?.displayName || caseData?.internalRef,
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
      piiMasked: piiMaskingApplied || (piiMasked !== undefined ? piiMasked : session.piiMaskingEnabled),
      maskingMetadata: piiMaskingMetadata || maskingMetadata,
    });

    // Create audit log for SOAP generation with PII masking
    if (piiMaskingApplied || session.piiMaskingEnabled) {
      const PiiAuditLog = require("../../../Models/PiiAuditLog");
      await new (mongoose.model("PiiAuditLog"))({
        session: sessionId,
        user: userId,
        action: "soap_generated",
        entityType: "soap_note",
        entityId: soapNote._id,
        piiEntitiesCount: piiMaskingMetadata?.totalEntitiesMasked || 0,
        piiEntitiesByType: piiMaskingMetadata?.entitiesByType || {},
        maskingOptions: {
          maskNames: true,
          maskNric: true,
          maskPhone: true,
          maskEmail: true,
          maskDates: false,
          maskAddresses: true,
          maskMedicalIds: true,
          maskFinancial: true
        },
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip,
        details: `SOAP note generated from ${piiMaskingApplied ? 'PII-masked' : 'original'} transcript`
      }).save();
    }

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
        400
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
        403
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
        populate: { path: "case", select: "displayName internalRef" },
      },
      { path: "approvedBy", select: "-password" },
    ]);

    return json.successResponse(
      res,
      {
        message: "SOAP note updated successfully",
        keyName: "soapNote",
        data: soapNote,
      },
      200
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
        403
      );
    }

    // Approve the note
    soapNote.status = "Approved";
    soapNote.approvedBy = userId;
    soapNote.approvedAt = new Date();

    await soapNote.save();
    await soapNote.populate([
      {
        path: "session",
        select: "sessionNumber sessionDate case",
        populate: { path: "case", select: "displayName internalRef" },
      },
      { path: "approvedBy", select: "-password" },
    ]);

    return json.successResponse(
      res,
      {
        message: "SOAP note approved successfully",
        keyName: "soapNote",
        data: soapNote,
      },
      200
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
        403
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
          populate: { path: "case", select: "displayName internalRef" },
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
      200
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
        populate: { path: "case", select: "displayName internalRef" },
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
        403
      );
    }

    return json.successResponse(
      res,
      {
        message: "SOAP note fetched successfully",
        keyName: "soapNote",
        data: soapNote,
      },
      200
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
        400
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
        403
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

    await Soap.findByIdAndDelete(id);

    return json.successResponse(
      res,
      {
        message: "SOAP note deleted successfully",
        keyName: "data",
        data: { id },
      },
      200
    );
  } catch (err) {
    console.error("Failed to delete SOAP note:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to delete SOAP note";
    return json.errorResponse(res, errorMessage, 500);
  }
};

module.exports = o;
