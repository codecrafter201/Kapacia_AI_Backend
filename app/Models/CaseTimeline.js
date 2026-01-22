"use strict";
const mongoose = require("mongoose");

const caseTimelineSchema = new mongoose.Schema(
  {
    case: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Case",
      required: true,
    },
    eventType: {
      type: String,
      enum: ["session", "file_upload", "timeline_summary"],
      required: true,
    },

    // Reference to the actual resource
    session: { type: mongoose.Schema.Types.ObjectId, ref: "Session" },
    file: { type: mongoose.Schema.Types.ObjectId, ref: "File" },
    timelineSummary: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TimelineSummary",
    },

    // Event metadata
    eventDate: { type: Date, required: true },
    eventDescription: { type: String },

    // Who performed the action
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

caseTimelineSchema.index({ case: 1, eventDate: -1 });
caseTimelineSchema.index({ case: 1, eventType: 1 });

mongoose.model("CaseTimeline", caseTimelineSchema);
