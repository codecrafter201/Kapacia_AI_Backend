"use strict";
const mongoose = require("mongoose");

const piiAuditLogSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    action: {
      type: String,
      enum: [
        "mask_applied",
        "unmask_viewed", 
        "transcript_created",
        "transcript_edited",
        "soap_generated",
        "export_performed"
      ],
      required: true,
    },
    entityType: {
      type: String,
      enum: ["transcript", "soap_note", "export"],
      required: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    piiEntitiesCount: { type: Number, default: 0 },
    piiEntitiesByType: { type: Object }, // { nric: 2, phone: 1, email: 3 }
    maskingOptions: { type: Object }, // Masking configuration used
    userAgent: { type: String },
    ipAddress: { type: String },
    details: { type: String }, // Additional context
  },
  { timestamps: true }
);

// Indexes for efficient querying
piiAuditLogSchema.index({ session: 1, createdAt: -1 });
piiAuditLogSchema.index({ user: 1, createdAt: -1 });
piiAuditLogSchema.index({ action: 1, createdAt: -1 });

mongoose.model("PiiAuditLog", piiAuditLogSchema);