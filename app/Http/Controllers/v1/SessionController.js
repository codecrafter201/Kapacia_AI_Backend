"use strict";

const mongoose = require("mongoose");
const Session = mongoose.model("Session");
const Case = mongoose.model("Case");
const timelineCtrl = require("./CaseTimelineController");
const s3Service = require("../../../Services/S3Service");

const json = require("../../../Traits/ApiResponser");

let o = {};

o.createSession = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const {
      caseId,
      sessionDate,
      language,
      piiMaskingEnabled,
      consentGiven,
      consentTimestamp,
    } = req.body;

    // Validate required fields
    if (!caseId) {
      return json.errorResponse(res, "caseId is required", 400);
    }

    // Verify the case exists and user has access to it
    const caseData = await Case.findById(caseId);
    if (!caseData) {
      return json.errorResponse(res, "Case not found", 404);
    }

    // Check if user is assigned to this case or is admin
    const user = await mongoose.model("User").findById(userId);
    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(res, "You don't have access to this case", 403);
    }

    // Get the next session number for this case
    const lastSession = await Session.findOne({ case: caseId })
      .sort({ sessionNumber: -1 })
      .limit(1);

    const sessionNumber = lastSession ? lastSession.sessionNumber + 1 : 1;

    // Create the session
    const newSession = new Session({
      case: caseId,
      sessionNumber,
      sessionDate: sessionDate || new Date(),
      language: language || "english",
      piiMaskingEnabled:
        piiMaskingEnabled !== undefined ? piiMaskingEnabled : true,
      consentGiven: consentGiven || false,
      consentTimestamp: consentGiven ? consentTimestamp || new Date() : null,
      createdBy: userId,
      status: "Created",
    });

    await newSession.save();

    // Update case session count
    caseData.sessionsCount = (caseData.sessionsCount || 0) + 1;
    caseData.lastSessionAt = newSession.sessionDate;
    await caseData.save();

    // Populate case details
    await newSession.populate([
      { path: "case", select: "displayName internalRef status" },
      { path: "createdBy", select: "-password" },
    ]);

    // Create timeline entry
    try {
      await timelineCtrl.createTimelineEntry(
        caseId,
        "session",
        newSession._id,
        newSession.sessionDate,
        userId,
        `Session ${sessionNumber} created`,
      );
    } catch (timelineErr) {
      console.error("Failed to create timeline entry:", timelineErr);
    }

    return json.successResponse(
      res,
      {
        message: "Session created successfully",
        keyName: "session",
        data: newSession,
      },
      201,
    );
  } catch (err) {
    console.error("Failed to create session:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to create session";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.updateSession = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;
    const {
      sessionDate,
      language,
      piiMaskingEnabled,
      piiWarningAcknowledged,
      consentGiven,
      consentTimestamp,
      status,
      errorMessage,
    } = req.body;

    const session = await Session.findById(id);
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

    // Update fields if provided
    if (sessionDate) session.sessionDate = sessionDate;
    if (language) session.language = language;
    if (piiMaskingEnabled !== undefined)
      session.piiMaskingEnabled = piiMaskingEnabled;
    if (piiWarningAcknowledged !== undefined)
      session.piiWarningAcknowledged = piiWarningAcknowledged;
    if (consentGiven !== undefined) {
      session.consentGiven = consentGiven;
      if (consentGiven) {
        session.consentTimestamp = consentTimestamp || new Date();
      }
    }
    if (status) session.status = status;
    if (errorMessage) session.errorMessage = errorMessage;

    await session.save();
    await session.populate([
      { path: "case", select: "displayName internalRef status" },
      { path: "createdBy", select: "-password" },
    ]);

    return json.successResponse(
      res,
      {
        message: "Session updated successfully",
        keyName: "session",
        data: session,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to update session:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to update session";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.startRecording = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;

    const session = await Session.findById(id);
    if (!session) {
      return json.errorResponse(res, "Session not found", 404);
    }

    // Check consent
    if (!session.consentGiven) {
      return json.errorResponse(
        res,
        "Patient consent is required before recording",
        400,
      );
    }

    // Check if user has access
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

    session.status = "Recording";
    session.hasRecording = true;
    await session.save();

    await session.populate([
      { path: "case", select: "displayName internalRef status" },
      { path: "createdBy", select: "-password" },
    ]);

    return json.successResponse(
      res,
      {
        message: "Recording started",
        keyName: "session",
        data: session,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to start recording:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to start recording";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.stopRecording = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;
    const { audioUrl, audioFileSizeBytes, durationSeconds } = req.body;

    console.log("[stopRecording] payload:", {
      audioUrl,
      audioFileSizeBytes,
      durationSeconds,
      paramsId: id,
      body: req.body,
    });

    const session = await Session.findById(id);
    if (!session) {
      return json.errorResponse(res, "Session not found", 404);
    }

    // Check if user has access
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

    session.audioUrl = audioUrl;
    session.audioFileSizeBytes = audioFileSizeBytes;
    session.durationSeconds = durationSeconds;
    session.status = "Processing";
    await session.save();

    console.log("[stopRecording] after save:", {
      sessionId: session._id,
      audioUrl: session.audioUrl,
      audioFileSizeBytes: session.audioFileSizeBytes,
      durationSeconds: session.durationSeconds,
    });

    await session.populate([
      { path: "case", select: "displayName internalRef status" },
      { path: "createdBy", select: "-password" },
    ]);

    return json.successResponse(
      res,
      {
        message: "Recording stopped and saved",
        keyName: "session",
        data: session,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to stop recording:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to stop recording";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getSessionsByCase = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { caseId } = req.params;
    const { status, language } = req.query;

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
    if (language) filter.language = language;

    const sessions = await Session.find(filter)
      .populate("case", "displayName internalRef status")
      .populate("createdBy", "-password")
      .sort({ sessionNumber: -1 });

    console.log("Fetched sessions:", sessions);

    return json.successResponse(
      res,
      {
        message: "Sessions fetched successfully",
        keyName: "sessions",
        data: sessions,
        stats: {
          total: sessions.length,
        },
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch sessions:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch sessions";
    return json.errorResponse(res, errorMessage, 500);
  }
};

// Get recent sessions for the authenticated practitioner (for dashboard)
o.getRecentSessions = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { limit = 5 } = req.query;

    // Find cases assigned to this user
    const cases = await Case.find({ assignedTo: userId }).select(
      "_id displayName internalRef status",
    );
    const caseIds = cases.map((c) => c._id);

    if (!caseIds.length) {
      return json.successResponse(
        res,
        {
          message: "No sessions found for user",
          keyName: "sessions",
          data: [],
        },
        200,
      );
    }

    const safeLimit = Math.min(parseInt(limit) || 5, 20);

    const sessions = await Session.find({ case: { $in: caseIds } })
      .populate("case", "displayName internalRef status")
      .populate("createdBy", "name email role")
      .sort({ sessionDate: -1, createdAt: -1 })
      .limit(safeLimit);

    return json.successResponse(
      res,
      {
        message: "Recent sessions fetched successfully",
        keyName: "sessions",
        data: sessions,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch recent sessions:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch recent sessions";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getSessionById = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;

    const session = await Session.findById(id)
      .populate("case", "displayName internalRef status tags assignedTo")
      .populate("createdBy", "-password");

    if (!session) {
      return json.errorResponse(res, "Session not found", 404);
    }

    // Check if user has access
    const caseData = await Case.findById(session.case._id);
    const user = await mongoose.model("User").findById(userId);
    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      session.createdBy._id.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "You don't have access to this session",
        403,
      );
    }

    return json.successResponse(
      res,
      {
        message: "Session fetched successfully",
        keyName: "session",
        data: session,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch session:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch session";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.deleteSession = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;

    const session = await Session.findById(id);
    if (!session) {
      return json.errorResponse(res, "Session not found", 404);
    }

    // Check if user has access
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

    // Update case session count
    if (caseData.sessionsCount > 0) {
      caseData.sessionsCount -= 1;
      await caseData.save();
    }

    await Session.findByIdAndDelete(id);

    return json.successResponse(
      res,
      {
        message: "Session deleted successfully",
        keyName: "data",
        data: { id },
      },
      200,
    );
  } catch (err) {
    console.error("Failed to delete session:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to delete session";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.uploadRecording = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;
    const { sessionId, durationSeconds, audioFileSizeBytes } = req.body;

    // Validate session exists
    const session = await Session.findById(sessionId || id);
    if (!session) {
      return json.errorResponse(res, "Session not found", 404);
    }

    // Check if user has access
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

    // Check if file was uploaded
    if (!req.file) {
      return json.errorResponse(res, "No audio file provided", 400);
    }

    try {
      console.log(
        `[SessionController] Uploading audio for session: ${sessionId || id}`,
      );
      console.log(`[SessionController] File size: ${req.file.size} bytes`);

      // Upload to S3
      const s3Response = await s3Service.uploadAudio(
        req.file.buffer,
        sessionId || id,
        req.file.originalname,
      );

      console.log(`[SessionController] S3 upload successful:`, s3Response);

      // Update session with audio URL and metadata
      session.audioUrl = s3Response.url;
      session.audioS3Key = s3Response.key;
      session.audioFileSizeBytes = audioFileSizeBytes || req.file.size;
      session.durationSeconds = durationSeconds || 0;
      session.status = "Processing";

      console.log("[uploadRecording] before save:", {
        sessionId: session._id,
        audioUrl: session.audioUrl,
        audioS3Key: session.audioS3Key,
        audioFileSizeBytes: session.audioFileSizeBytes,
        durationSeconds: session.durationSeconds,
      });

      await session.save();

      console.log("[uploadRecording] after save:", {
        sessionId: session._id,
        audioUrl: session.audioUrl,
        audioS3Key: session.audioS3Key,
      });

      await session.populate([
        { path: "case", select: "displayName internalRef status" },
        { path: "createdBy", select: "-password" },
      ]);

      return json.successResponse(
        res,
        {
          message: "Recording uploaded successfully",
          keyName: "session",
          data: session,
          audioUrl: s3Response.url,
        },
        200,
      );
    } catch (s3Error) {
      console.error("[SessionController] S3 upload failed:", s3Error);
      return json.errorResponse(
        res,
        `Failed to upload recording: ${s3Error.message}`,
        500,
      );
    }
  } catch (err) {
    console.error("Failed to upload recording:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to upload recording";
    return json.errorResponse(res, errorMessage, 500);
  }
};

// Get a fresh presigned URL for the session's audio file
o.getPresignedAudioUrl = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;

    const session = await Session.findById(id).populate(
      "case",
      "assignedTo displayName internalRef",
    );
    if (!session) {
      return json.errorResponse(res, "Session not found", 404);
    }

    // Access check: assigned practitioner or admin can fetch URL
    const user = await mongoose.model("User").findById(userId);
    if (
      session.case.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "You don't have access to this session",
        403,
      );
    }

    // Determine key
    let key = session.audioS3Key;
    if (!key && session.audioUrl) {
      // Try to derive key from stored URL
      try {
        const url = new URL(session.audioUrl);
        // URL path starts with /<bucketKey>
        key = decodeURIComponent(url.pathname.replace(/^\//, ""));
      } catch (e) {
        // ignore
      }
    }

    if (!key) {
      return json.errorResponse(
        res,
        "No audio key found for this session",
        400,
      );
    }

    // Default 15 minutes
    const expiresIn = parseInt(process.env.S3_PRESIGN_EXPIRY || "900", 10);
    const signedUrl = await s3Service.getPresignedUrl(key, expiresIn);

    return json.successResponse(
      res,
      {
        message: "Presigned URL generated",
        keyName: "audio",
        data: {
          url: signedUrl,
          key,
          expiresIn,
          expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        },
      },
      200,
    );
  } catch (err) {
    console.error("Failed to generate presigned audio URL:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to generate presigned URL";
    return json.errorResponse(res, errorMessage, 500);
  }
};

// Admin: Get all sessions (for dashboard stats)
o.getAllSessions = async (req, res, next) => {
  try {
    const { limit = 5, page = 1 } = req.query;

    const safeLimit = Math.min(parseInt(limit) || 5, 100);
    const pageNum = parseInt(page) || 1;
    const skip = (pageNum - 1) * safeLimit;

    // Get total count
    const total = await Session.countDocuments();

    // Get paginated sessions
    const sessions = await Session.find()
      .populate("case", "displayName internalRef status")
      .populate("createdBy", "name email role")
      .sort({ sessionDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(safeLimit);

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / safeLimit);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    return json.successResponse(
      res,
      {
        message: "All sessions fetched successfully",
        keyName: "sessions",
        data: sessions,
        pagination: {
          page: pageNum,
          limit: safeLimit,
          total,
          totalPages,
          hasNextPage,
          hasPrevPage,
        },
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch all sessions:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch sessions";
    return json.errorResponse(res, errorMessage, 500);
  }
};

module.exports = o;
