"use strict";

const mongoose = require("mongoose");
const S3Service = require("./S3Service");
const AuditLogService = require("./AuditLogService");

/**
 * Data Retention Service
 * Handles automatic deletion of raw audio recordings and draft transcripts
 * based on compliance requirements:
 * - 7 days after SOAP note approval
 * - 30 days after creation if never approved
 */
class DataRetentionService {
  /**
   * Process all sessions that need data retention cleanup
   * Should be called by a scheduled job (cron)
   * @returns {Promise<Object>} Summary of deletion results
   */
  async processRetentionPolicies() {
    const Session = mongoose.model("Session");
    const Soap = mongoose.model("Soap");
    const Transcript = mongoose.model("Transcript");

    const now = new Date();
    const results = {
      totalProcessed: 0,
      audioDeleted: 0,
      transcriptsDeleted: 0,
      errors: [],
      sessionsProcessed: [],
    };

    try {
      console.log("[DataRetention] Starting retention policy check...");

      // Find sessions scheduled for deletion that haven't been processed yet
      const sessionsToProcess = await Session.find({
        deletionScheduledAt: { $lte: now },
        retentionStatus: "ScheduledForDeletion",
        $or: [
          { audioDeletedAt: { $exists: false } },
          { transcriptDeletedAt: { $exists: false } },
        ],
      });

      console.log(
        `[DataRetention] Found ${sessionsToProcess.length} sessions to process`,
      );

      for (const session of sessionsToProcess) {
        try {
          const sessionResult = await this.deleteSessionData(session);
          results.totalProcessed++;
          results.audioDeleted += sessionResult.audioDeleted ? 1 : 0;
          results.transcriptsDeleted += sessionResult.transcriptDeleted ? 1 : 0;
          results.sessionsProcessed.push({
            sessionId: session._id,
            ...sessionResult,
          });
        } catch (error) {
          console.error(
            `[DataRetention] Error processing session ${session._id}:`,
            error,
          );
          results.errors.push({
            sessionId: session._id,
            error: error.message,
          });
        }
      }

      console.log(
        `[DataRetention] Completed. Processed: ${results.totalProcessed}, Audio deleted: ${results.audioDeleted}, Transcripts deleted: ${results.transcriptsDeleted}`,
      );

      return results;
    } catch (error) {
      console.error(
        "[DataRetention] Failed to process retention policies:",
        error,
      );
      throw error;
    }
  }

  /**
   * Delete audio and transcript data for a specific session
   * @param {Object} session - Mongoose session document
   * @returns {Promise<Object>} Deletion results
   */
  async deleteSessionData(session) {
    const Transcript = mongoose.model("Transcript");
    const result = {
      audioDeleted: false,
      transcriptDeleted: false,
      audioError: null,
      transcriptError: null,
    };

    // Delete audio from S3 if it exists and hasn't been deleted yet
    if (session.audioS3Key && !session.audioDeletedAt) {
      try {
        await S3Service.deleteAudio(session.audioS3Key);
        session.audioDeletedAt = new Date();
        session.audioUrl = null; // Clear the URL since file no longer exists
        result.audioDeleted = true;
        console.log(
          `[DataRetention] Deleted audio for session ${session._id}: ${session.audioS3Key}`,
        );
      } catch (error) {
        result.audioError = error.message;
        console.error(
          `[DataRetention] Failed to delete audio for session ${session._id}:`,
          error,
        );
      }
    }

    // Delete transcript if it exists and hasn't been deleted yet
    if (!session.transcriptDeletedAt) {
      try {
        const transcript = await Transcript.findOne({ session: session._id });
        if (transcript) {
          await Transcript.deleteOne({ _id: transcript._id });
          session.transcriptDeletedAt = new Date();
          result.transcriptDeleted = true;
          console.log(
            `[DataRetention] Deleted transcript for session ${session._id}`,
          );
        }
      } catch (error) {
        result.transcriptError = error.message;
        console.error(
          `[DataRetention] Failed to delete transcript for session ${session._id}:`,
          error,
        );
      }
    }

    // Update session status if both audio and transcript are deleted
    if (session.audioDeletedAt && session.transcriptDeletedAt) {
      session.retentionStatus = "Deleted";
    }

    await session.save();

    // Audit: record what happened for admins
    try {
      await AuditLogService.createLog({
        user: null, // System action
        action: "DELETE",
        actionCategory: "DATA_RETENTION",
        resourceType: "Session",
        resourceId: session._id,
        caseId: session.case,
        sessionId: session._id,
        details: {
          actor: "System (DataRetentionCron)",
          deletionScheduledAt: session.deletionScheduledAt,
          deletedAt: new Date(),
          audioDeleted: result.audioDeleted,
          transcriptDeleted: result.transcriptDeleted,
          audioError: result.audioError,
          transcriptError: result.transcriptError,
          audioKey: session.audioS3Key,
        },
      });
    } catch (auditErr) {
      console.error("[DataRetention] Failed to write audit log:", auditErr);
    }

    return result;
  }

  /**
   * Schedule a session for deletion 7 days after SOAP note approval
   * Called when a SOAP note is approved
   * @param {String} sessionId - Session ID
   * @returns {Promise<Object>} Updated session
   */
  async schedulePostApprovalDeletion(sessionId) {
    const Session = mongoose.model("Session");
    const session = await Session.findById(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Schedule deletion for 7 days from now
    const deletionDate = new Date();
    deletionDate.setDate(deletionDate.getDate() + 7);

    session.deletionScheduledAt = deletionDate;
    session.retentionStatus = "ScheduledForDeletion";

    await session.save();

    // Audit: scheduled 7-day deletion after approval
    try {
      await AuditLogService.createLog({
        user: null,
        action: "SCHEDULE_DELETE",
        actionCategory: "DATA_RETENTION",
        resourceType: "Session",
        resourceId: session._id,
        caseId: session.case,
        sessionId: session._id,
        details: {
          actor: "System (SOAP approval)",
          reason: "Approved note: delete after 7 days",
          deletionScheduledAt: deletionDate,
        },
      });
    } catch (auditErr) {
      console.error(
        "[DataRetention] Failed to write audit log for schedule:",
        auditErr,
      );
    }

    console.log(
      `[DataRetention] Scheduled session ${sessionId} for deletion on ${deletionDate}`,
    );

    return session;
  }

  /**
   * Check and schedule deletion for sessions older than 30 days without approval
   * Should be called by scheduled job
   * @returns {Promise<Object>} Summary of scheduled sessions
   */
  async scheduleUnapprovedSessionDeletions() {
    const Session = mongoose.model("Session");
    const Soap = mongoose.model("Soap");

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const results = {
      totalScheduled: 0,
      sessions: [],
    };

    try {
      console.log(
        "[DataRetention] Checking for unapproved sessions older than 30 days...",
      );

      // Find sessions created more than 30 days ago that are not yet scheduled for deletion
      const oldSessions = await Session.find({
        createdAt: { $lt: thirtyDaysAgo },
        retentionStatus: "Active",
        $or: [
          { audioS3Key: { $exists: true, $ne: null } },
          // Sessions that might have transcripts
          { status: { $in: ["TranscriptionComplete", "Ready"] } },
        ],
      });

      console.log(
        `[DataRetention] Found ${oldSessions.length} old sessions to check`,
      );

      for (const session of oldSessions) {
        try {
          // Check if this session has an approved SOAP note
          const approvedNote = await Soap.findOne({
            session: session._id,
            status: "Approved",
          });

          // If no approved note exists, schedule for immediate deletion
          if (!approvedNote) {
            session.deletionScheduledAt = new Date(); // Delete now
            session.retentionStatus = "ScheduledForDeletion";
            await session.save();

            // Audit: scheduled 30-day timeout deletion
            try {
              await AuditLogService.createLog({
                user: null,
                action: "SCHEDULE_DELETE",
                actionCategory: "DATA_RETENTION",
                resourceType: "Session",
                resourceId: session._id,
                caseId: session.case,
                sessionId: session._id,
                details: {
                  actor: "System (RetentionPolicy)",
                  reason: "No approval after 30 days",
                  deletionScheduledAt: session.deletionScheduledAt,
                  createdAt: session.createdAt,
                },
              });
            } catch (auditErr) {
              console.error(
                "[DataRetention] Failed to write audit log for 30-day schedule:",
                auditErr,
              );
            }

            results.totalScheduled++;
            results.sessions.push({
              sessionId: session._id,
              createdAt: session.createdAt,
              reason: "No approval after 30 days",
            });

            console.log(
              `[DataRetention] Scheduled unapproved session ${session._id} for immediate deletion (created ${session.createdAt})`,
            );
          }
        } catch (error) {
          console.error(
            `[DataRetention] Error checking session ${session._id}:`,
            error,
          );
        }
      }

      console.log(
        `[DataRetention] Scheduled ${results.totalScheduled} unapproved sessions for deletion`,
      );

      return results;
    } catch (error) {
      console.error(
        "[DataRetention] Failed to schedule unapproved sessions:",
        error,
      );
      throw error;
    }
  }

  /**
   * Run complete retention policy check and cleanup
   * Combines both scheduling unapproved and processing scheduled deletions
   * @returns {Promise<Object>} Combined results
   */
  async runCompleteRetentionCheck() {
    console.log(
      "[DataRetention] ========== Starting Complete Retention Check ==========",
    );

    const results = {
      timestamp: new Date(),
      schedulingResults: null,
      deletionResults: null,
    };

    try {
      // Step 1: Schedule old unapproved sessions
      results.schedulingResults =
        await this.scheduleUnapprovedSessionDeletions();

      // Step 2: Process all scheduled deletions
      results.deletionResults = await this.processRetentionPolicies();

      console.log(
        "[DataRetention] ========== Retention Check Complete ==========",
      );

      return results;
    } catch (error) {
      console.error("[DataRetention] Complete retention check failed:", error);
      throw error;
    }
  }

  /**
   * Get retention status for a specific session
   * @param {String} sessionId - Session ID
   * @returns {Promise<Object>} Retention information
   */
  async getSessionRetentionStatus(sessionId) {
    const Session = mongoose.model("Session");
    const Soap = mongoose.model("Soap");

    const session = await Session.findById(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const approvedNote = await Soap.findOne({
      session: sessionId,
      status: "Approved",
    });

    return {
      sessionId: session._id,
      retentionStatus: session.retentionStatus,
      deletionScheduledAt: session.deletionScheduledAt,
      audioDeletedAt: session.audioDeletedAt,
      transcriptDeletedAt: session.transcriptDeletedAt,
      hasAudio: !!session.audioS3Key,
      audioS3Key: session.audioS3Key,
      createdAt: session.createdAt,
      hasApprovedNote: !!approvedNote,
      approvedNoteDate: approvedNote?.approvedAt,
      daysUntilDeletion: session.deletionScheduledAt
        ? Math.ceil(
            (session.deletionScheduledAt - new Date()) / (1000 * 60 * 60 * 24),
          )
        : null,
    };
  }
}

module.exports = new DataRetentionService();
