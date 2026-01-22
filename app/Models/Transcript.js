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
    
    // PII Masking fields
    maskedText: { type: String }, // PII-masked version of rawText
    maskedEditedText: { type: String }, // PII-masked version of editedText
    piiMaskingEnabled: { type: Boolean, default: true },
    piiMaskingMetadata: { type: Object }, // Stores masking details and entity mapping
    hasPii: { type: Boolean, default: false }, // Quick flag for PII detection
    
    wordCount: { type: Number },
    languageDetected: { type: String },
    confidenceScore: { type: Number },
    segments: { type: Array },
    maskedSegments: { type: Array }, // PII-masked version of segments
    status: {
      type: String,
      enum: ["Draft", "Reviewed", "Approved"],
      default: "Draft",
    },
  },
  { timestamps: true }
);

mongoose.model("Transcript", transcriptSchema);
