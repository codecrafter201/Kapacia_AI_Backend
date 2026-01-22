"use strict";
const mongoose = require("mongoose");

const transcriptSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      unique: true,
      required: true,
    },
    rawText: { type: String, required: true },
    editedText: { type: String },
    isEdited: { type: Boolean, default: false },
    
    // AWS PII redaction fields
    piiMaskingEnabled: { type: Boolean, default: true },
    piiMaskingMetadata: { type: Object }, // Stores AWS redaction metadata
    hasPii: { type: Boolean, default: false }, // Quick flag for PII detection
    
    wordCount: { type: Number },
    languageDetected: { type: String },
    confidenceScore: { type: Number },
    segments: { type: Array },
    status: {
      type: String,
      enum: ["Draft", "Reviewed", "Approved"],
      default: "Draft",
    },
  },
  { timestamps: true }
);

mongoose.model("Transcript", transcriptSchema);
