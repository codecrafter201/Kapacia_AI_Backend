"use strict";

const mongoose = require("mongoose");
const Transcript = mongoose.model("Transcript");
const Session = mongoose.model("Session");
const Case = mongoose.model("Case");

const json = require("../../../Traits/ApiResponser");

let o = {};

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

    // Create transcript
    const newTranscript = new Transcript({
      session: sessionId,
      rawText,
      editedText: editedText || null,
      isEdited: !!editedText,
      wordCount: wordCount || rawText.split(/\s+/).length,
      languageDetected: languageDetected || "english",
      confidenceScore: confidenceScore || null,
      segments: segments || [],
      status: status || "Draft",
    });

    await newTranscript.save();

    await newTranscript.populate([
      { path: "session", select: "sessionNumber sessionDate language status" },
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
          select: "sessionNumber sessionDate language status case",
        },
      ],
    );

    if (!transcript) {
      return json.errorResponse(res, "Transcript not found for this session", 404);
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
    }
    if (status) transcript.status = status;
    if (wordCount) transcript.wordCount = wordCount;
    if (confidenceScore !== undefined) transcript.confidenceScore = confidenceScore;

    await transcript.save();

    await transcript.populate([
      {
        path: "session",
        select: "sessionNumber sessionDate language status",
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
