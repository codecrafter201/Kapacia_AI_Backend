"use strict";
const mongoose = require("mongoose");

const caseSchema = new mongoose.Schema(
  {
    displayName: { type: String, required: true },
    internalRef: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["Active", "Closed", "OnHold", "Unapporved"],
      default: "Active",
    },
    tags: [{ type: String }],
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    notesCount: { type: Number, default: 0 },
    fileUploadsCount: { type: Number, default: 0 },
    sessionsCount: { type: Number, default: 0 },
    lastSessionAt: { type: Date },
  },
  { timestamps: true }
);

caseSchema.index({ assignedTo: 1, status: 1 });
caseSchema.index({ tags: 1 });
caseSchema.index({ internalRef: 1 });

mongoose.model("Case", caseSchema);
