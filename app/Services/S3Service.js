"use strict";

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("crypto");

// Helper function to generate UUID v4
function generateUUID() {
  return crypto.randomUUID();
}

class S3Service {
  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      // Increase retry attempts for large uploads
      maxAttempts: 5,
    });
    this.bucketName = process.env.AWS_S3_BUCKET_NAME;
  }

  /**
   * Generate a presigned URL for an object key
   * @param {string} key - S3 object key
   * @param {number} expiresInSeconds - Expiry in seconds (default 900 = 15 minutes)
   * @returns {Promise<string>} - Presigned URL
   */
  async getPresignedUrl(key, expiresInSeconds = 900) {
    if (!this.bucketName) {
      throw new Error("AWS_S3_BUCKET_NAME environment variable not set");
    }
    if (!key) {
      throw new Error("S3 key is required to generate presigned URL");
    }

    try {
      console.log(`[S3Service] Generating presigned URL for key: ${key}`);
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: expiresInSeconds,
      });

      console.log(
        `[S3Service] Presigned URL generated successfully (expires in ${expiresInSeconds}s)`,
      );
      return signedUrl;
    } catch (error) {
      console.error("[S3Service] Failed to generate presigned URL:", {
        key,
        bucket: this.bucketName,
        region: process.env.AWS_REGION,
        error: error.message,
        code: error.code,
      });

      // Provide helpful error messages
      if (error.code === "NoSuchKey") {
        throw new Error(
          `Audio file not found in S3. Key: ${key}. The file may have been deleted.`,
        );
      }
      if (error.code === "AccessDenied") {
        throw new Error(
          `S3 Access Denied. IAM user needs s3:GetObject permission on bucket "${this.bucketName}"`,
        );
      }
      if (error.code === "NoSuchBucket") {
        throw new Error(
          `S3 bucket does not exist: ${this.bucketName}. Check AWS_S3_BUCKET_NAME environment variable.`,
        );
      }

      throw new Error(`Failed to generate presigned URL: ${error.message}`);
    }
  }

  /**
   * Upload audio file to S3
   * @param {Buffer} buffer - Audio file buffer
   * @param {string} sessionId - Session ID for organizing files
   * @param {string} fileName - Original file name
   * @returns {Promise<{url: string, key: string, size: number}>}
   */
  async uploadAudio(buffer, sessionId, fileName = null) {
    if (!this.bucketName) {
      throw new Error("AWS_S3_BUCKET_NAME environment variable not set");
    }

    if (!buffer) {
      throw new Error("Buffer is required");
    }

    try {
      // Generate unique key for S3 object
      const timestamp = Date.now();
      const uniqueId = generateUUID();
      const extension = fileName ? fileName.split(".").pop() : "webm";
      const key = `recordings/${sessionId}/${timestamp}-${uniqueId}.${extension}`;

      console.log(`[S3Service] Uploading to S3:`);
      console.log(`  Bucket: ${this.bucketName}`);
      console.log(`  Key: ${key}`);
      console.log(
        `  Size: ${buffer.length} bytes (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`,
      );

      // Use PutObject for files (AWS SDK v3 handles multipart internally for large files)
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: this.getContentType(extension, "audio/webm"),
        Metadata: {
          sessionId,
          uploadedAt: new Date().toISOString(),
        },
      });

      console.log(`[S3Service] Starting upload...`);
      const startTime = Date.now();
      const response = await this.s3Client.send(command);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log(`[S3Service] Upload successful:`, {
        ETag: response.ETag,
        Key: key,
        Duration: `${duration}s`,
      });

      // Generate URL based on S3 configuration
      const url = this.generateS3Url(key);

      return {
        url,
        key,
        size: buffer.length,
        eTag: response.ETag,
      };
    } catch (error) {
      const duration = error.duration || "unknown";
      console.error("[S3Service] Upload failed:", {
        message: error.message,
        code: error.code,
        name: error.name,
        bucket: this.bucketName,
        region: process.env.AWS_REGION,
        duration: duration,
      });

      // Provide helpful error messages
      if (error.code === "ECONNRESET" || error.name === "TimeoutError") {
        throw new Error(
          `S3 Connection timeout. The upload took too long. This could be due to: 1) Slow network connection, 2) Large file size, 3) AWS region issues. Try again or split the file.`,
        );
      }

      if (error.code === "AccessDenied") {
        throw new Error(
          `S3 Access Denied. IAM user needs s3:PutObject permission on bucket "${this.bucketName}"`,
        );
      }

      throw new Error(`Failed to upload audio to S3: ${error.message}`);
    }
  }

  /**
   * Upload any file to S3 (PDF, DOCX, TXT, images, etc.)
   * @param {Buffer} buffer - File buffer
   * @param {string} keyPrefix - Folder prefix (e.g., "case-files/<caseId>")
   * @param {string} fileName - Original file name
   * @param {string} mimeType - MIME type from upload
   * @returns {Promise<{url: string, key: string, size: number, eTag: string}>}
   */
  async uploadFile(buffer, keyPrefix, fileName, mimeType) {
    if (!this.bucketName) {
      throw new Error("AWS_S3_BUCKET_NAME environment variable not set");
    }

    if (!buffer) {
      throw new Error("Buffer is required");
    }

    const timestamp = Date.now();
    const uniqueId = generateUUID();
    const extension = fileName ? fileName.split(".").pop() || "bin" : "bin";
    const key = `${keyPrefix}/${timestamp}-${uniqueId}.${extension}`;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: this.getContentType(extension, mimeType),
        Metadata: {
          uploadedAt: new Date().toISOString(),
        },
      });

      const response = await this.s3Client.send(command);
      const url = this.generateS3Url(key);

      return {
        url,
        key,
        size: buffer.length,
        eTag: response.ETag,
      };
    } catch (error) {
      console.error("[S3Service] File upload failed:", error);
      throw new Error(`Failed to upload file to S3: ${error.message}`);
    }
  }

  /**
   * Generate S3 URL for the uploaded object
   * @param {string} key - S3 object key
   * @returns {string} S3 URL
   */
  generateS3Url(key) {
    // Using virtual-hosted-style URL format
    const baseUrl = `https://${this.bucketName}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com`;
    return `${baseUrl}/${key}`;
  }

  /**
   * Get content type based on file extension
   * @param {string} extension - File extension
   * @returns {string} Content type
   */
  getContentType(extension, fallback = "application/octet-stream") {
    const mimeTypes = {
      webm: "audio/webm",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      m4a: "audio/mp4",
      ogg: "audio/ogg",
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      txt: "text/plain",
      csv: "text/csv",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
    };

    return mimeTypes[extension.toLowerCase()] || fallback;
  }

  /**
   * Delete audio file from S3
   * @param {string} key - S3 object key
   * @returns {Promise<void>}
   */
  async deleteAudio(key) {
    if (!this.bucketName) {
      throw new Error("AWS_S3_BUCKET_NAME environment variable not set");
    }

    try {
      const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      console.log(`[S3Service] Deleted: ${key}`);
    } catch (error) {
      console.error("[S3Service] Delete failed:", error);
      throw new Error(`Failed to delete audio from S3: ${error.message}`);
    }
  }

  async deleteFile(key) {
    return this.deleteAudio(key);
  }
}

module.exports = new S3Service();
