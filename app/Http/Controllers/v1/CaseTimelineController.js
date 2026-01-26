"use strict";

const mongoose = require("mongoose");
const CaseTimeline = mongoose.model("CaseTimeline");
const Case = mongoose.model("Case");
const Session = mongoose.model("Session");

const json = require("../../../Traits/ApiResponser");

let o = {};

// Helper function to create timeline entry
o.createTimelineEntry = async (
  caseId,
  eventType,
  resourceId,
  eventDate,
  performedBy,
  eventDescription = null,
) => {
  try {
    const timelineEntry = {
      case: caseId,
      eventType,
      eventDate,
      performedBy,
      eventDescription,
    };

    // Set the appropriate reference based on event type
    if (eventType === "session") {
      timelineEntry.session = resourceId;
    } else if (eventType === "file_upload") {
      timelineEntry.file = resourceId;
    } else if (eventType === "timeline_summary") {
      timelineEntry.timelineSummary = resourceId;
    }

    const timeline = new CaseTimeline(timelineEntry);
    await timeline.save();
    return timeline;
  } catch (err) {
    console.error("Failed to create timeline entry:", err);
    throw err;
  }
};

o.getCaseTimeline = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { caseId } = req.params;
    const { eventType, sessionStatus, startDate, endDate, allEntries, page, limit } =
      req.query;

    // Verify the case exists and user has access to it
    const caseData = await Case.findById(caseId);
    if (!caseData) {
      return json.errorResponse(res, "Case not found", 404);
    }

    const user = await mongoose.model("User").findById(userId);
    if (
      caseData.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(res, "You don't have access to this case", 403);
    }

    // Build filter
    const filter = { case: caseId };

    // Filter by session status (only applicable to session timeline entries)
    if (sessionStatus) {
      const statuses = sessionStatus
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s);

      if (statuses.length > 0) {
        filter.eventType = "session";

        // Find sessions for this case that match the requested statuses
        const matchingSessions = await Session.find({
          case: caseId,
          status: { $in: statuses },
        }).select("_id");

        const sessionIds = matchingSessions.map((s) => s._id);

        // If no sessions match, short-circuit with empty results
        if (sessionIds.length === 0) {
          return json.successResponse(
            res,
            {
              message: "Case timeline fetched successfully",
              keyName: "timeline",
              data: [],
              pagination: {
                total: 0,
                currentPage: 1,
                pageSize: parseInt(limit) || 5,
                totalPages: 0,
                hasMore: false,
              },
              stats: {
                total: 0,
                sessions: 0,
                fileUploads: 0,
                summaries: 0,
              },
            },
            200,
          );
        }

        filter.session = { $in: sessionIds };
      }
    }

    // Filter by event type if provided
    if (eventType) {
      const validTypes = ["session", "file_upload", "timeline_summary"];
      const types = eventType.split(",").filter((t) => validTypes.includes(t));
      if (types.length > 0) {
        filter.eventType = { $in: types };
      }
    }

    // Filter by date range if provided
    if (startDate && endDate) {
      filter.eventDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    } else if (startDate) {
      filter.eventDate = { $gte: new Date(startDate) };
    } else if (endDate) {
      filter.eventDate = { $lte: new Date(endDate) };
    }

    // Pagination settings
    const isAllEntries = allEntries === "true";
    const pageNumber = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || 5; // Default 5 records per page
    const skip = (pageNumber - 1) * pageLimit;

    // Build query
    let query = CaseTimeline.find(filter)
      .populate("case", "displayName internalRef")
      .populate("performedBy", "-password")
      .populate({
        path: "session",
        select:
          "sessionNumber sessionDate status language durationSeconds hasRecording",
      })
      .populate({
        path: "file",
        select: "fileName fileUrl mimeType fileSizeBytes uploaded_at",
      })
      .populate({
        path: "timelineSummary",
        select: "version status periodStart periodEnd sessionCount fileCount",
      })
      .sort({ created_at: -1 });

    // Apply pagination if not requesting all entries
    if (!isAllEntries) {
      query = query.skip(skip).limit(pageLimit);
    }

    const timeline = await query;

    // Get total count for pagination info
    const totalCount = await CaseTimeline.countDocuments(filter);

    return json.successResponse(
      res,
      {
        message: "Case timeline fetched successfully",
        keyName: "timeline",
        data: timeline,
        pagination: {
          total: totalCount,
          currentPage: pageNumber,
          pageSize: pageLimit,
          totalPages: Math.ceil(totalCount / pageLimit),
          hasMore: skip + pageLimit < totalCount,
        },
        stats: {
          total: timeline.length,
          sessions: timeline.filter((t) => t.eventType === "session").length,
          fileUploads: timeline.filter((t) => t.eventType === "file_upload")
            .length,
          summaries: timeline.filter((t) => t.eventType === "timeline_summary")
            .length,
        },
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch case timeline:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch case timeline";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.deleteTimelineEntry = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;

    const timelineEntry = await CaseTimeline.findById(id).populate("case");
    if (!timelineEntry) {
      return json.errorResponse(res, "Timeline entry not found", 404);
    }

    // Check if user has access
    const user = await mongoose.model("User").findById(userId);
    if (
      timelineEntry.case.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(
        res,
        "You don't have access to this timeline entry",
        403,
      );
    }

    await CaseTimeline.findByIdAndDelete(id);

    return json.successResponse(
      res,
      {
        message: "Timeline entry deleted successfully",
        keyName: "data",
        data: { id },
      },
      200,
    );
  } catch (err) {
    console.error("Failed to delete timeline entry:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to delete timeline entry";
    return json.errorResponse(res, errorMessage, 500);
  }
};

module.exports = o;
