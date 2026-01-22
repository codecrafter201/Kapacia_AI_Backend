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
