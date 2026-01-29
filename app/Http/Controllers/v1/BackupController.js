"use strict";

const mongoose = require("mongoose");
const json = require("../../../Traits/ApiResponser");
const AuditLogService = require("../../../Services/AuditLogService");

let o = {};

o.backupAllData = async (req, res, next) => {
  try {
    // Fetch user for audit log
    const user = await mongoose.model("User").findById(req.decoded._id);

    // Fetch all data from different collections
    const [
      users,
      cases,
      sessions,
      files,
      soapNotes,
      transcripts,
      timelineSummaries,
      caseTimelines,
      auditLogs,
      systemSettings,
    ] = await Promise.all([
      mongoose.model("User").find().select("-password").lean(),
      mongoose.model("Case").find().populate("assignedTo", "name email").lean(),
      mongoose
        .model("Session")
        .find()
        .populate("caseId", "displayName")
        .populate("userId", "name email")
        .lean(),
      mongoose
        .model("File")
        .find()
        .populate("caseId", "displayName")
        .populate("uploadedBy", "name email")
        .lean(),
      mongoose
        .model("Soap")
        .find()
        .populate("sessionId", "sessionNumber")
        .populate("caseId", "displayName")
        .lean(),
      mongoose
        .model("Transcript")
        .find()
        .populate("sessionId", "sessionNumber")
        .lean(),
      mongoose
        .model("TimelineSummary")
        .find()
        .populate("caseId", "displayName")
        .populate("createdBy", "name email")
        .lean(),
      mongoose
        .model("CaseTimeline")
        .find()
        .populate("caseId", "displayName")
        .lean(),
      mongoose
        .model("AuditLog")
        .find()
        .populate("user", "name email role")
        .lean(),
      mongoose.model("SystemSettings").find().lean(),
    ]);

    // Prepare backup data
    const backupData = {
      backupMetadata: {
        backupDate: new Date().toISOString(),
        backupVersion: "1.0",
        performedBy: {
          id: user._id,
          name: user.name,
          email: user.email,
        },
        totalRecords: {
          users: users.length,
          cases: cases.length,
          sessions: sessions.length,
          files: files.length,
          soapNotes: soapNotes.length,
          transcripts: transcripts.length,
          timelineSummaries: timelineSummaries.length,
          caseTimelines: caseTimelines.length,
          auditLogs: auditLogs.length,
          systemSettings: systemSettings.length,
        },
      },
      data: {
        users,
        cases,
        sessions,
        files,
        soapNotes,
        transcripts,
        timelineSummaries,
        caseTimelines,
        auditLogs,
        systemSettings,
      },
    };

    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `kapacia-backup-${timestamp}.json`;

    // Create audit log for backup
    await AuditLogService.createLog({
      user,
      action: "EXPORT",
      actionCategory: "ADMIN",
      resourceType: "backup",
      details: {
        backupType: "FULL_SYSTEM_BACKUP",
        totalRecords: backupData.backupMetadata.totalRecords,
        backupDate: backupData.backupMetadata.backupDate,
        exportFormat: "JSON",
      },
      req,
    });

    // Set headers and send file
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(JSON.stringify(backupData, null, 2));
  } catch (error) {
    console.error("Error creating backup:", error);
    const errorMessage =
      error.message || error.toString() || "Failed to create backup";
    return json.errorResponse(res, errorMessage, 500);
  }
};

module.exports = o;
