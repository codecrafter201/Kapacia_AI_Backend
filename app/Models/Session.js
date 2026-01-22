"use strict";
const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
  {
    case: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true },
    sessionNumber: { type: Number, required: true },
    sessionDate: { type: Date, default: Date.now },
    hasRecording: { type: Boolean, default: false },
    audioUrl: { type: String },
    audioS3Key: { type: String },
    audioFileSizeBytes: { type: Number },
    durationSeconds: { type: Number },

    consentGiven: { type: Boolean, default: false },
    consentTimestamp: { type: Date },

    language: {
      type: String,
      enum: ["english", "mandarin"],
      default: "english",
    },

    piiMaskingEnabled: { type: Boolean, default: true },
    piiWarningAcknowledged: { type: Boolean, default: false },

    status: {
      type: String,
      enum: [
        "Created",
        "Recording",
        "Processing",
        "TranscriptionComplete",
        "Ready",
        "Error",
        "Approved",
        "Rejected",
      ],
      default: "Created",
    },
    errorMessage: { type: String },
    speechmaticsJobId: { type: String },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

sessionSchema.index({ case: 1, sessionNumber: 1 }, { unique: true });

mongoose.model("Session", sessionSchema);
