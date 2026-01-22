"use strict";
const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  userEmail: { type: String },
  userRole: { type: String },

  action: { type: String, required: true },
  actionCategory: { type: String },

  resourceType: { type: String, required: true },
  resourceId: { type: mongoose.Schema.Types.ObjectId },

  case: { type: mongoose.Schema.Types.ObjectId, ref: "Case" },
  session: { type: mongoose.Schema.Types.ObjectId, ref: "Session" },

  details: { type: Object },

  ipAddress: { type: String },
  userAgent: { type: String },
  requestId: { type: String },

  timestamp: { type: Date, default: Date.now },
});

mongoose.model("AuditLog", auditLogSchema);
