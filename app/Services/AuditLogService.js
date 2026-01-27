"use strict";

const mongoose = require("mongoose");
require("../Models/AuditLogs");
const AuditLog = mongoose.model("AuditLog");

class AuditLogService {
  /**
   * Create an audit log entry
   * @param {Object} logData - The audit log data
   * @param {Object} logData.user - User object or user ID
   * @param {String} logData.action - Action performed (e.g., 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'EXPORT')
   * @param {String} logData.actionCategory - Category (e.g., 'USER', 'CASE', 'SESSION', 'FILE', 'SOAP', 'TRANSCRIPT')
   * @param {String} logData.resourceType - Type of resource (e.g., 'User', 'Case', 'Session')
   * @param {String} logData.resourceId - ID of the resource
   * @param {String} logData.caseId - Related case ID (optional)
   * @param {String} logData.sessionId - Related session ID (optional)
   * @param {Object} logData.details - Additional details
   * @param {Object} req - Express request object for IP and user agent
   */
  static async createLog({
    user,
    action,
    actionCategory,
    resourceType,
    resourceId,
    caseId,
    sessionId,
    details = {},
    req,
  }) {
    try {
      const logEntry = {
        action,
        actionCategory,
        resourceType,
        resourceId,
        details,
        timestamp: new Date(),
      };

      // Handle user information
      if (user) {
        logEntry.user = user._id || user;
        logEntry.userEmail = user.email;
        logEntry.userRole = user.role;
      }

      // Add case and session references if provided
      if (caseId) logEntry.case = caseId;
      if (sessionId) logEntry.session = sessionId;

      // Extract request metadata
      if (req) {
        logEntry.ipAddress =
          req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;
        logEntry.userAgent = req.headers["user-agent"];
        logEntry.requestId = req.id || req.headers["x-request-id"];
      }

      const auditLog = new AuditLog(logEntry);
      await auditLog.save();

      return auditLog;
    } catch (error) {
      console.error("Failed to create audit log:", error);
      // Don't throw error to prevent audit logging from breaking the main flow
      return null;
    }
  }

  /**
   * Get all audit logs with filtering and pagination
   */
  static async getAllLogs({
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
  }) {
    try {
      const query = {};

      if (userId) query.user = userId;
      if (action) query.action = action;
      if (actionCategory) query.actionCategory = actionCategory;
      if (resourceType) query.resourceType = resourceType;
      if (caseId) query.case = caseId;
      if (sessionId) query.session = sessionId;

      if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = new Date(startDate);
        if (endDate) query.timestamp.$lte = new Date(endDate);
      }

      const skip = (page - 1) * limit;

      const [logs, total] = await Promise.all([
        AuditLog.find(query)
          .populate("user", "name email role")
          .populate("case", "caseName caseId")
          .populate("session", "sessionName")
          .sort({ timestamp: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        AuditLog.countDocuments(query),
      ]);

      return {
        logs,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      console.error("Failed to fetch audit logs:", error);
      throw error;
    }
  }

  /**
   * Get audit logs for a specific case
   */
  static async getCaseLogs(caseId, options = {}) {
    return this.getAllLogs({ ...options, caseId });
  }

  /**
   * Get audit logs for a specific user
   */
  static async getUserLogs(userId, options = {}) {
    return this.getAllLogs({ ...options, userId });
  }

  /**
   * Get audit logs for a specific session
   */
  static async getSessionLogs(sessionId, options = {}) {
    return this.getAllLogs({ ...options, sessionId });
  }

  /**
   * Delete old audit logs (for cleanup/archival)
   */
  static async deleteOldLogs(daysToKeep = 90) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await AuditLog.deleteMany({
        timestamp: { $lt: cutoffDate },
      });

      return result;
    } catch (error) {
      console.error("Failed to delete old audit logs:", error);
      throw error;
    }
  }
}

module.exports = AuditLogService;
