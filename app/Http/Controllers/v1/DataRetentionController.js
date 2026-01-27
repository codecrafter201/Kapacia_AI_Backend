"use strict";

const DataRetentionService = require("../../../Services/DataRetentionService");
const json = require("../../../Traits/ApiResponser");

const o = (module.exports = {});

/**
 * Manually trigger complete retention policy check
 * Admin only - runs both scheduling and deletion
 */
o.runRetentionCheck = async (req, res, next) => {
  try {
    console.log(
      "[DataRetentionController] Manual retention check initiated by admin",
    );

    const results = await DataRetentionService.runCompleteRetentionCheck();

    return json.successResponse(
      res,
      {
        message: "Data retention check completed successfully",
        keyName: "results",
        data: {
          timestamp: results.timestamp,
          scheduling: {
            totalScheduled: results.schedulingResults?.totalScheduled || 0,
            sessions: results.schedulingResults?.sessions || [],
          },
          deletion: {
            totalProcessed: results.deletionResults?.totalProcessed || 0,
            audioDeleted: results.deletionResults?.audioDeleted || 0,
            transcriptsDeleted:
              results.deletionResults?.transcriptsDeleted || 0,
            errors: results.deletionResults?.errors || [],
            sessionsProcessed:
              results.deletionResults?.sessionsProcessed || [],
          },
        },
      },
      200,
    );
  } catch (err) {
    console.error("[DataRetentionController] Failed to run retention check:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to run retention check";
    return json.errorResponse(res, errorMessage, 500);
  }
};

/**
 * Get retention status for a specific session
 */
o.getSessionRetentionStatus = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    const status =
      await DataRetentionService.getSessionRetentionStatus(sessionId);

    return json.successResponse(
      res,
      {
        message: "Retention status retrieved successfully",
        keyName: "retentionStatus",
        data: status,
      },
      200,
    );
  } catch (err) {
    console.error(
      "[DataRetentionController] Failed to get retention status:",
      err,
    );
    const errorMessage =
      err.message || err.toString() || "Failed to get retention status";
    return json.errorResponse(
      res,
      errorMessage,
      err.message.includes("not found") ? 404 : 500,
    );
  }
};

/**
 * Get summary of all retention statuses
 */
o.getRetentionSummary = async (req, res, next) => {
  try {
    const mongoose = require("mongoose");
    const Session = mongoose.model("Session");

    const summary = await Session.aggregate([
      {
        $group: {
          _id: "$retentionStatus",
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          status: "$_id",
          count: 1,
        },
      },
    ]);

    // Get sessions scheduled for deletion soon (within next 7 days)
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const upcomingDeletions = await Session.countDocuments({
      deletionScheduledAt: { $lte: sevenDaysFromNow, $gte: new Date() },
      retentionStatus: "ScheduledForDeletion",
    });

    // Get overdue deletions (should have been deleted already)
    const overdueDeletions = await Session.countDocuments({
      deletionScheduledAt: { $lt: new Date() },
      retentionStatus: "ScheduledForDeletion",
    });

    return json.successResponse(
      res,
      {
        message: "Retention summary retrieved successfully",
        keyName: "summary",
        data: {
          statusBreakdown: summary,
          upcomingDeletions,
          overdueDeletions,
        },
      },
      200,
    );
  } catch (err) {
    console.error("[DataRetentionController] Failed to get summary:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to get retention summary";
    return json.errorResponse(res, errorMessage, 500);
  }
};
