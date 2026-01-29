"use strict";

const mongoose = require("mongoose");
const File = mongoose.model("File");
const Case = mongoose.model("Case");
const Session = mongoose.model("Session");
const s3Service = require("../../../Services/S3Service");
const timelineCtrl = require("./CaseTimelineController");

const json = require("../../../Traits/ApiResponser");
const AuditLogService = require("../../../Services/AuditLogService");

let o = {};

o.uploadFile = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { caseId } = req.body;
    const file = req.file;

    // Validate file exists
    if (!file) {
      return json.errorResponse(res, "No file provided", 400);
    }

    // Validate required fields
    if (!caseId) {
      return json.errorResponse(res, "caseId is required", 400);
    }

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

    // Upload file to S3
    const keyPrefix = `case-files/${caseId}`;
    const uploadResult = await s3Service.uploadFile(
      file.buffer,
      keyPrefix,
      file.originalname,
      file.mimetype,
    );

    // Create file record in database
    const newFile = new File({
      case: caseId,
      fileName: file.originalname,
      fileUrl: uploadResult.url,
      fileSizeBytes: file.size,
      mimeType: file.mimetype,
      storageKey: uploadResult.key,
      uploadedBy: userId,
    });

    await newFile.save();

    // Populate references
    await newFile.populate([
      { path: "case", select: "displayName " },
      { path: "uploadedBy", select: "-password" },
    ]);

    // Create timeline entry
    try {
      await timelineCtrl.createTimelineEntry(
        caseId,
        "file_upload",
        newFile._id,
        new Date(),
        userId,
        `File uploaded: ${file.originalname}`,
      );
    } catch (timelineErr) {
      console.error("Failed to create timeline entry:", timelineErr);
    }

    // Increment file uploads count for the case
    try {
      await Case.findByIdAndUpdate(caseId, { $inc: { fileUploadsCount: 1 } });
    } catch (countErr) {
      console.error("Failed to update file count:", countErr);
    }

    await AuditLogService.createLog({
      user,
      action: "UPLOAD",
      actionCategory: "FILE",
      resourceType: "File",
      resourceId: newFile._id,
      caseId: newFile.case,
      details: {
        fileName: newFile.fileName,
        mimeType: newFile.mimeType,
        fileSizeBytes: newFile.fileSizeBytes,
      },
      req,
    });

    return json.successResponse(
      res,
      {
        message: "File uploaded successfully",
        keyName: "file",
        data: newFile,
      },
      201,
    );
  } catch (err) {
    console.error("Failed to upload file:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to upload file";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getFilesByCase = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { caseId } = req.params;
    const { mimeType } = req.query;

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
    if (mimeType) filter.mimeType = { $regex: mimeType, $options: "i" };

    const files = await File.find(filter)
      .populate("case", "displayName ")
      .populate("uploadedBy", "-password")
      .sort({ uploaded_at: -1 });

    return json.successResponse(
      res,
      {
        message: "Files fetched successfully",
        keyName: "files",
        data: files,
        stats: {
          total: files.length,
        },
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch files:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch files";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getFileById = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;

    const file = await File.findById(id)
      .populate("case", "displayName  assignedTo")
      .populate("uploadedBy", "-password");

    if (!file) {
      return json.errorResponse(res, "File not found", 404);
    }

    // Check if user has access
    const user = await mongoose.model("User").findById(userId);
    if (
      file.case.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(res, "You don't have access to this file", 403);
    }

    return json.successResponse(
      res,
      {
        message: "File fetched successfully",
        keyName: "file",
        data: file,
      },
      200,
    );
  } catch (err) {
    console.error("Failed to fetch file:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch file";
    return json.errorResponse(res, errorMessage, 500);
  }
};

// Get a presigned URL to access/download the file from S3
o.getPresignedFileUrl = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;

    const file = await File.findById(id)
      .populate("case", "assignedTo")
      .populate("uploadedBy", "-password");

    if (!file) {
      return json.errorResponse(res, "File not found", 404);
    }

    // Access check
    const user = await mongoose.model("User").findById(userId);
    if (
      file.case.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(res, "You don't have access to this file", 403);
    }

    // Determine storage key
    let storageKey = file.storageKey;
    if (!storageKey && file.fileUrl) {
      try {
        const url = new URL(file.fileUrl);
        storageKey = decodeURIComponent(url.pathname.replace(/^\//, ""));
      } catch (e) {
        console.warn("Failed to derive storage key from fileUrl", e.message);
      }
    }

    if (!storageKey) {
      return json.errorResponse(
        res,
        "No storage key found for this file. Please re-upload the file.",
        400,
      );
    }

    // Generate presigned URL (15 minutes default)
    const expiresIn = parseInt(process.env.S3_PRESIGN_EXPIRY || "900", 10);
    const url = await s3Service.getPresignedUrl(storageKey, expiresIn);

    return json.successResponse(
      res,
      {
        message: "Presigned URL generated",
        keyName: "file",
        data: {
          url,
          expiresIn,
          fileName: file.fileName,
          mimeType: file.mimeType,
        },
      },
      200,
    );
  } catch (err) {
    console.error("Failed to generate presigned file URL:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to generate presigned URL";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.deleteFile = async (req, res, next) => {
  try {
    const { _id: userId } = req.decoded;
    const { id } = req.params;

    const file = await File.findById(id).populate("case");
    if (!file) {
      return json.errorResponse(res, "File not found", 404);
    }

    // Check if user has access
    const user = await mongoose.model("User").findById(userId);
    if (
      file.case.assignedTo.toString() !== userId.toString() &&
      user.role !== "admin"
    ) {
      return json.errorResponse(res, "You don't have access to this file", 403);
    }

    // Delete from S3 if key is stored
    if (file.storageKey) {
      try {
        await s3Service.deleteFile(file.storageKey);
      } catch (s3Err) {
        console.error("Failed to delete from S3:", s3Err);
        // Continue with database deletion even if S3 deletion fails
      }
    }

    // Decrement file uploads count for the case
    try {
      const caseId = file.case._id || file.case;
      await Case.findByIdAndUpdate(caseId, { $inc: { fileUploadsCount: -1 } });
    } catch (countErr) {
      console.error("Failed to update file count:", countErr);
    }

    await AuditLogService.createLog({
      user,
      action: "DELETE",
      actionCategory: "FILE",
      resourceType: "File",
      resourceId: req.params.id,
      caseId: file.case,
      details: {
        fileName: file.fileName,
        deletedAt: new Date(),
      },
      req,
    });

    await File.findByIdAndDelete(id);

    return json.successResponse(
      res,
      {
        message: "File deleted successfully",
        keyName: "data",
        data: { id },
      },
      200,
    );
  } catch (err) {
    console.error("Failed to delete file:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to delete file";
    return json.errorResponse(res, errorMessage, 500);
  }
};

module.exports = o;
