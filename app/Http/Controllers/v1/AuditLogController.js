"use strict";

const AuditLogService = require("../../../Services/AuditLogService");
const json = require("../../../Traits/ApiResponser");

let o = {};

o.getAllAuditLogs = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 50,
      userId,
      action,
      actionCategory,
      resourceType,
      caseId,
      sessionId,
      startDate,
      endDate,
    } = req.query;

    const result = await AuditLogService.getAllLogs({
      page: parseInt(page),
      limit: parseInt(limit),
      userId,
      action,
      actionCategory,
      resourceType,
      caseId,
      sessionId,
      startDate,
      endDate,
    });

    return json.successResponse(
      res,
      {
        message: "Audit logs retrieved successfully",
        keyName: "data",
        data: {
          auditLogs: result.logs,
          pagination: result.pagination,
        },
      },
      200,
    );
  } catch (error) {
    console.error("Error fetching audit logs:", error);
    const errorMessage =
      error.message || error.toString() || "Failed to fetch audit logs";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getCaseAuditLogs = async (req, res, next) => {
  try {
    const { caseId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const result = await AuditLogService.getCaseLogs(caseId, {
      page: parseInt(page),
      limit: parseInt(limit),
    });

    return json.successResponse(
      res,
      {
        message: "Case audit logs retrieved successfully",
        keyName: "data",
        data: {
          auditLogs: result.logs,
          pagination: result.pagination,
        },
      },
      200,
    );
  } catch (error) {
    console.error("Error fetching case audit logs:", error);
    const errorMessage =
      error.message || error.toString() || "Failed to fetch case audit logs";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getUserAuditLogs = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const result = await AuditLogService.getUserLogs(userId, {
      page: parseInt(page),
      limit: parseInt(limit),
    });

    return json.successResponse(
      res,
      {
        message: "User audit logs retrieved successfully",
        keyName: "data",
        data: {
          auditLogs: result.logs,
          pagination: result.pagination,
        },
      },
      200,
    );
  } catch (error) {
    console.error("Error fetching user audit logs:", error);
    const errorMessage =
      error.message || error.toString() || "Failed to fetch user audit logs";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getSessionAuditLogs = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const result = await AuditLogService.getSessionLogs(sessionId, {
      page: parseInt(page),
      limit: parseInt(limit),
    });

    return json.successResponse(
      res,
      {
        message: "Session audit logs retrieved successfully",
        keyName: "data",
        data: {
          auditLogs: result.logs,
          pagination: result.pagination,
        },
      },
      200,
    );
  } catch (error) {
    console.error("Error fetching session audit logs:", error);
    const errorMessage =
      error.message || error.toString() || "Failed to fetch session audit logs";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.exportAuditLogs = async (req, res, next) => {
  try {
    const {
      format = "csv",
      userId,
      action,
      actionCategory,
      resourceType,
      caseId,
      sessionId,
      startDate,
      endDate,
    } = req.query;

    const supportedFormats = ["csv", "json"];
    const selectedFormat = String(format).toLowerCase();

    if (!supportedFormats.includes(selectedFormat)) {
      return json.errorResponse(
        res,
        `Unsupported format. Supported formats: ${supportedFormats.join(", ")}`,
        400,
      );
    }

    // Fetch all matching logs without pagination
    const result = await AuditLogService.getAllLogs({
      page: 1,
      limit: 10000, // Large limit to get all logs
      userId,
      action,
      actionCategory,
      resourceType,
      caseId,
      sessionId,
      startDate,
      endDate,
    });

    const logs = result.logs;

    if (!logs || logs.length === 0) {
      return json.errorResponse(res, "No audit logs found to export", 404);
    }

    // Fetch user for audit log
    const mongoose = require("mongoose");
    const user = await mongoose.model("User").findById(req.decoded._id);

    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `audit-logs-${timestamp}.${selectedFormat}`;

    if (selectedFormat === "json") {
      // Export as JSON
      const jsonData = {
        exportedAt: new Date().toISOString(),
        totalRecords: logs.length,
        filters: {
          userId,
          action,
          actionCategory,
          resourceType,
          caseId,
          sessionId,
          startDate,
          endDate,
        },
        auditLogs: logs,
      };

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      return res.status(200).send(JSON.stringify(jsonData, null, 2));
    }

    if (selectedFormat === "csv") {
      // Export as CSV
      const headers = [
        "Timestamp",
        "User Name",
        "User Email",
        "User Role",
        "Action",
        "Action Category",
        "Resource Type",
        "Resource ID",
        "Case ID",
        "Session ID",
        "Details",
        "IP Address",
        "User Agent",
      ];

      const rows = logs.map((log) => [
        new Date(log.timestamp).toISOString(),
        log.user?.name || log.userEmail || "Unknown",
        log.userEmail || "-",
        log.user?.role || log.userRole || "-",
        log.action,
        log.actionCategory,
        log.resourceType,
        log.resourceId || "-",
        log.case?._id || "-",
        log.session?._id || "-",
        JSON.stringify(log.details || {}),
        log.ipAddress || "-",
        log.userAgent || "-",
      ]);

      const csvContent = [
        headers.join(","),
        ...rows.map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
        ),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );

      // Create audit log for export
      await AuditLogService.createLog({
        user,
        action: "EXPORT",
        actionCategory: "AUDIT_LOG",
        resourceType: "auditLogs",
        details: {
          exportFormat: selectedFormat.toUpperCase(),
          totalRecords: logs.length,
          filters: {
            userId,
            action,
            actionCategory,
            resourceType,
            caseId,
            sessionId,
            startDate,
            endDate,
          },
          exportedAt: new Date(),
        },
        req,
      });

      return res.status(200).send(csvContent);
    }
  } catch (error) {
    console.error("Error exporting audit logs:", error);
    const errorMessage =
      error.message || error.toString() || "Failed to export audit logs";
    return json.errorResponse(res, errorMessage, 500);
  }
};

module.exports = o;
