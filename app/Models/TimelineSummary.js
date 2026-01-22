"use strict";
const mongoose = require("mongoose");

const timelineSummarySchema = new mongoose.Schema(
  {
    case: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true },
    version: { type: Number, default: 1 },

    summaryContent: { type: Object, required: true },
    summaryText: { type: String, required: true },

    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    sessionsIncluded: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Session" },
    ],
    filesIncluded: [{ type: mongoose.Schema.Types.ObjectId, ref: "File" }],

    sessionCount: { type: Number },
    fileCount: { type: Number },

    filterCriteria: { type: Object },

    status: {
      type: String,
      enum: ["Draft", "Reviewed", "Approved"],
      default: "Draft",
    },

    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    aiModelVersion: { type: String },

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },

    locked: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

timelineSummarySchema.index({ case: 1, version: 1 }, { unique: true });

mongoose.model("TimelineSummary", timelineSummarySchema);
