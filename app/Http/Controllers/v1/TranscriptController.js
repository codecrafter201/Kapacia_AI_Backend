"use strict";

const mongoose = require("mongoose");
const Transcript = mongoose.model("Transcript");
const Session = mongoose.model("Session");
const Case = mongoose.model("Case");
const PiiAuditLog = mongoose.model("PiiAuditLog");
const PiiMaskingService = require("../../../Services/PiiMaskingService");

const json = require("../../../Traits/ApiResponser");

let o = {};

// Initialize PII masking service
const piiMaskingService = new PiiMaskingService();

o.createTranscript = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const {
      sessionId,
      rawText,
      editedText,
      wordCount,
      languageDetected,
      confidenceScore,
      segments,
      status,
    } = req.body;

    // Validate required fields
    if (!sessionId || !rawText) {
      return json.errorResponse(
        res,
        "sessionId and rawText are required",
        400,
      );
    }

    // Verify session exists
    const session = await Session.findById(sessionId);
    if (!session) {
      return json.errorResponse(res, "Session not found", 404);
    }

    // Check if user has access to this session
    const caseData = await Case.findById(session.case);
    const user = await mongoose.model("User").findById(userId);
    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "You don't have access to this session",
        403,
      );
    }

    // Check if transcript already exists for this session
    const existingTranscript = await Transcript.findOne({ session: sessionId });
    if (existingTranscript) {
      return json.errorResponse(
        res,
        "Transcript already exists for this session",
        400,
      );
    }

    // Apply PII masking if enabled
    let maskedText = null;
    let maskedEditedText = null;
    let maskedSegments = null;
    let piiMaskingMetadata = null;
    let hasPii = false;

    const piiMaskingEnabled = session.piiMaskingEnabled !== false;

    if (piiMaskingEnabled) {
      // Mask raw text
      const rawTextMaskingResult = piiMaskingService.maskPii(rawText, {
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

      maskedText = rawTextMaskingResult.maskedText;
      piiMaskingMetadata = rawTextMaskingResult.metadata;
      hasPii = rawTextMaskingResult.metadata.maskingApplied;

      // Mask edited text if provided
      if (editedText) {
        const editedTextMaskingResult = piiMaskingService.maskPii(editedText, {
          maskNames: true,
          maskNric: true,
          maskPhone: true,
          maskEmail: true,
          maskDates: false,
          maskAddresses: true,
          maskMedicalIds: true,
          maskFinancial: true,
          preserveLength: false
        });
        maskedEditedText = editedTextMaskingResult.maskedText;
        
        // Merge metadata if both texts have PII
        if (editedTextMaskingResult.metadata.maskingApplied) {
          hasPii = true;
          piiMaskingMetadata.entities = [
            ...piiMaskingMetadata.entities,
            ...editedTextMaskingResult.metadata.entities
          ];
        }
      }

      // Mask segments if provided
      if (segments && Array.isArray(segments)) {
        maskedSegments = segments.map(segment => {
          if (segment.text) {
            const segmentMaskingResult = piiMaskingService.maskPii(segment.text, {
              maskNames: true,
              maskNric: true,
              maskPhone: true,
              maskEmail: true,
              maskDates: false,
              maskAddresses: true,
              maskMedicalIds: true,
              maskFinancial: true,
              preserveLength: false
            });
            return {
              ...segment,
              text: segmentMaskingResult.maskedText,
              originalText: segment.text,
              piiDetected: segmentMaskingResult.metadata.maskingApplied
            };
          }
          return segment;
        });
      }

      console.log(`[TranscriptController] PII masking applied for session ${sessionId}:`, {
        hasPii,
        entitiesCount: piiMaskingMetadata?.totalEntitiesMasked || 0,
        entitiesByType: piiMaskingMetadata?.entitiesByType || {}
      });
    }

    // Create transcript
    const newTranscript = new Transcript({
      session: sessionId,
      rawText,
      editedText: editedText || null,
      isEdited: !!editedText,
      
      // PII masking fields
      maskedText,
      maskedEditedText,
      piiMaskingEnabled,
      piiMaskingMetadata,
      hasPii,
      
      wordCount: wordCount || rawText.split(/\s+/).length,
      languageDetected: languageDetected || "english",
      confidenceScore: confidenceScore || null,
      segments: segments || [],
      maskedSegments: maskedSegments || segments || [],
      status: status || "Draft",
    });

    await newTranscript.save();

    // Create audit log entry
    if (piiMaskingEnabled && hasPii) {
      await new PiiAuditLog({
        session: sessionId,
        user: userId,
        action: "transcript_created",
        entityType: "transcript",
        entityId: newTranscript._id,
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
        details: `Transcript created with PII masking applied`
      }).save();
    }

    await newTranscript.populate([
      { path: "session", select: "sessionNumber sessionDate language status piiMaskingEnabled" },
    ]);

    return json.successResponse(
      res,
      {
        message: "Transcript created successfully",
        keyName: "transcript",
        data: newTranscript,
      },
      201,
    );
  } catch (err) {
    console.error("Failed to create transcript:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to create transcript";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getTranscriptBySession = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { sessionId } = req.params;
    const { viewUnmasked = false } = req.query;

    // Verify session exists
    const session = await Session.findById(sessionId);
    if (!session) {
      return json.errorResponse(res, "Session not found", 404);
    }

    // Check if user has access
    const caseData = await Case.findById(session.case);
    const user = await mongoose.model("User").findById(userId);
    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      session.createdBy.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "You don't have access to this session",
        403,
      );
    }

    const transcript = await Transcript.findOne({ session: sessionId }).populate(
      [
        {
          path: "session",
          select: "sessionNumber sessionDate language status case piiMaskingEnabled",
        },
      ],
    );

    if (!transcript) {
      return json.errorResponse(res, "Transcript not found for this session", 404);
    }

    // Handle PII masking display logic
    let responseData = { ...transcript.toObject() };

    if (transcript.piiMaskingEnabled && transcript.hasPii) {
      if (viewUnmasked === 'true' && (user.role === 'admin' || user.role === 'practitioner')) {
        // User requested unmasked view and has permission
        // Keep original data but log the access
        await new PiiAuditLog({
          session: sessionId,
          user: userId,
          action: "unmask_viewed",
          entityType: "transcript",
          entityId: transcript._id,
          piiEntitiesCount: transcript.piiMaskingMetadata?.totalEntitiesMasked || 0,
          piiEntitiesByType: transcript.piiMaskingMetadata?.entitiesByType || {},
          userAgent: req.get('User-Agent'),
          ipAddress: req.ip,
          details: `User viewed unmasked transcript`
        }).save();

        console.log(`[TranscriptController] User ${userId} viewed unmasked transcript for session ${sessionId}`);
      } else {
        // Return masked version by default
        responseData.rawText = transcript.maskedText || transcript.rawText;
        responseData.editedText = transcript.maskedEditedText || transcript.editedText;
        responseData.segments = transcript.maskedSegments || transcript.segments;
        responseData.displayMode = 'masked';
      }
    }

    return json.successResponse(
      res,
      {
        message: "Transcript fetched successfully",
        keyName: "transcript",
        data: responseData,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch transcript:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch transcript";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getTranscriptById = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;

    const transcript = await Transcript.findById(id).populate([
      {
        path: "session",
        select: "sessionNumber sessionDate language status case",
      },
    ]);

    if (!transcript) {
      return json.errorResponse(res, "Transcript not found", 404);
    }

    // Check if user has access
    const session = await Session.findById(transcript.session._id);
    const caseData = await Case.findById(session.case);
    const user = await mongoose.model("User").findById(userId);
    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      session.createdBy.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "You don't have access to this transcript",
        403,
      );
    }

    return json.successResponse(
      res,
      {
        message: "Transcript fetched successfully",
        keyName: "transcript",
        data: transcript,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch transcript:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch transcript";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.updateTranscript = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;
    const { editedText, status, wordCount, confidenceScore } = req.body;

    const transcript = await Transcript.findById(id);
    if (!transcript) {
      return json.errorResponse(res, "Transcript not found", 404);
    }

    // Check if user has access
    const session = await Session.findById(transcript.session);
    const caseData = await Case.findById(session.case);
    const user = await mongoose.model("User").findById(userId);
    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "You don't have access to this transcript",
        403,
      );
    }

    // Update fields
    if (editedText !== undefined) {
      transcript.editedText = editedText;
      transcript.isEdited = !!editedText;

      // Apply PII masking to edited text if enabled
      if (transcript.piiMaskingEnabled && editedText) {
        const editedTextMaskingResult = piiMaskingService.maskPii(editedText, {
          maskNames: true,
          maskNric: true,
          maskPhone: true,
          maskEmail: true,
          maskDates: false,
          maskAddresses: true,
          maskMedicalIds: true,
          maskFinancial: true,
          preserveLength: false
        });

        transcript.maskedEditedText = editedTextMaskingResult.maskedText;

        // Update PII metadata if new PII detected
        if (editedTextMaskingResult.metadata.maskingApplied) {
          transcript.hasPii = true;
          
          // Merge with existing metadata
          if (transcript.piiMaskingMetadata) {
            transcript.piiMaskingMetadata.entities = [
              ...transcript.piiMaskingMetadata.entities,
              ...editedTextMaskingResult.metadata.entities
            ];
            transcript.piiMaskingMetadata.totalEntitiesMasked += editedTextMaskingResult.metadata.totalEntitiesMasked;
          } else {
            transcript.piiMaskingMetadata = editedTextMaskingResult.metadata;
          }

          // Create audit log for PII in edited text
          await new PiiAuditLog({
            session: transcript.session,
            user: userId,
            action: "transcript_edited",
            entityType: "transcript",
            entityId: transcript._id,
            piiEntitiesCount: editedTextMaskingResult.metadata.totalEntitiesMasked,
            piiEntitiesByType: editedTextMaskingResult.metadata.entitiesByType,
            userAgent: req.get('User-Agent'),
            ipAddress: req.ip,
            details: `Transcript edited with new PII detected and masked`
          }).save();

          console.log(`[TranscriptController] PII detected in edited text for transcript ${id}:`, {
            entitiesCount: editedTextMaskingResult.metadata.totalEntitiesMasked,
            entitiesByType: editedTextMaskingResult.metadata.entitiesByType
          });
        }
      }
    }

    if (status) transcript.status = status;
    if (wordCount) transcript.wordCount = wordCount;
    if (confidenceScore !== undefined) transcript.confidenceScore = confidenceScore;

    await transcript.save();

    await transcript.populate([
      {
        path: "session",
        select: "sessionNumber sessionDate language status piiMaskingEnabled",
      },
    ]);

    return json.successResponse(
      res,
      {
        message: "Transcript updated successfully",
        keyName: "transcript",
        data: transcript,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to update transcript:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to update transcript";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.deleteTranscript = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;

    const transcript = await Transcript.findById(id);
    if (!transcript) {
      return json.errorResponse(res, "Transcript not found", 404);
    }

    // Check if user has access
    const session = await Session.findById(transcript.session);
    const caseData = await Case.findById(session.case);
    const user = await mongoose.model("User").findById(userId);
    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "You don't have access to this transcript",
        403,
      );
    }

    await Transcript.findByIdAndDelete(id);

    return json.successResponse(
      res,
      {
        message: "Transcript deleted successfully",
        keyName: "data",
        data: { id },
      },
      200,
    );
  } catch (err) {
    console.error("Failed to delete transcript:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to delete transcript";
    return json.errorResponse(res, errorMessage, 500);
  }
};

module.exports = o;

// New endpoint to get PII audit logs for a session
o.getPiiAuditLogs = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { sessionId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Verify session exists and user has access
    const session = await Session.findById(sessionId);
    if (!session) {
      return json.errorResponse(res, "Session not found", 404);
    }

    const caseData = await Case.findById(session.case);
    const user = await mongoose.model("User").findById(userId);
    
    // Only admin and assigned practitioners can view audit logs
    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "You don't have access to audit logs for this session",
        403,
      );
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const auditLogs = await PiiAuditLog.find({ session: sessionId })
      .populate('user', 'firstName lastName email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalCount = await PiiAuditLog.countDocuments({ session: sessionId });

    return json.successResponse(
      res,
      {
        message: "PII audit logs fetched successfully",
        keyName: "auditLogs",
        data: auditLogs,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCount / parseInt(limit)),
          totalCount,
          hasNext: skip + auditLogs.length < totalCount,
          hasPrev: parseInt(page) > 1
        }
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch PII audit logs:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch PII audit logs";
    return json.errorResponse(res, errorMessage, 500);
  }
};

// New endpoint to get PII statistics for a session
o.getPiiStatistics = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { sessionId } = req.params;

    // Verify session exists and user has access
    const session = await Session.findById(sessionId);
    if (!session) {
      return json.errorResponse(res, "Session not found", 404);
    }

    const caseData = await Case.findById(session.case);
    const user = await mongoose.model("User").findById(userId);
    
    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      session.createdBy.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "You don't have access to this session",
        403,
      );
    }

    // Get transcript PII data
    const transcript = await Transcript.findOne({ session: sessionId });
    
    // Get audit log statistics
    const auditStats = await PiiAuditLog.aggregate([
      { $match: { session: mongoose.Types.ObjectId(sessionId) } },
      {
        $group: {
          _id: "$action",
          count: { $sum: 1 },
          totalPiiEntities: { $sum: "$piiEntitiesCount" }
        }
      }
    ]);

    const statistics = {
      sessionId,
      piiMaskingEnabled: session.piiMaskingEnabled,
      transcript: {
        hasPii: transcript?.hasPii || false,
        totalEntitiesMasked: transcript?.piiMaskingMetadata?.totalEntitiesMasked || 0,
        entitiesByType: transcript?.piiMaskingMetadata?.entitiesByType || {},
        lastProcessed: transcript?.piiMaskingMetadata?.processedAt || null
      },
      auditSummary: auditStats.reduce((acc, stat) => {
        acc[stat._id] = {
          count: stat.count,
          totalPiiEntities: stat.totalPiiEntities
        };
        return acc;
      }, {}),
      totalAuditEntries: auditStats.reduce((sum, stat) => sum + stat.count, 0)
    };

    return json.successResponse(
      res,
      {
        message: "PII statistics fetched successfully",
        keyName: "statistics",
        data: statistics,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch PII statistics:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch PII statistics";
    return json.errorResponse(res, errorMessage, 500);
  }
};