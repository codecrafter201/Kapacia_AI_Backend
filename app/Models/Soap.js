"use strict";
const mongoose = require("mongoose");

const noteSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
    },
    version: { type: Number, default: 1 },
    framework: { type: String, enum: ["SOAP", "DAP"], required: true },
    content: { type: Object, required: true },
    contentText: { type: String, required: true },
    generatedBy: { type: String },
    aiModelVersion: { type: String },

    piiMasked: { type: Boolean, default: false },
    maskingMetadata: { type: Object },

    status: {
      type: String,
      enum: ["Draft", "Reviewed", "Approved"],
      default: "Draft",
    },

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
  },
  { timestamps: true }
);

noteSchema.index({ session: 1, version: 1 }, { unique: true });

mongoose.model("Soap", noteSchema);
