"use strict";

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API routes for your application. These
| routes are loaded by the RouteServiceProvider within a group which
| is assigned the "api" middleware group. Enjoy building your API!
|
*/

const express = require("express");
require("express-group-routes");
const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage({}),
  limits: { fileSize: 500000000 },
});

/** Controllers **/
const userCtrl = require("../app/Http/Controllers/v1/UserController");
const authCtrl = require("../app/Http/Controllers/v1/AuthController");
const uploadCtrl = require("../app/Http/Controllers/v1/UploadController");
const statsCtrl = require("../app/Http/Controllers/v1/CsvController");
const caseCtrl = require("../app/Http/Controllers/v1/CaseController");
const sessionCtrl = require("../app/Http/Controllers/v1/SessionController");
const fileCtrl = require("../app/Http/Controllers/v1/FileController");
const timelineSummaryCtrl = require("../app/Http/Controllers/v1/TimelineSummaryController");
const caseTimelineCtrl = require("../app/Http/Controllers/v1/CaseTimelineController");
const soapCtrl = require("../app/Http/Controllers/v1/SoapController");
const transcriptCtrl = require("../app/Http/Controllers/v1/TranscriptController");
const auditLogCtrl = require("../app/Http/Controllers/v1/AuditLogController");
const backupCtrl = require("../app/Http/Controllers/v1/BackupController");
const dataRetentionCtrl = require("../app/Http/Controllers/v1/DataRetentionController");

const app = express.Router();

app.group("/user", (Route) => {
  Route.post("/register", userCtrl.register);
  Route.post("/login", userCtrl.login);
  Route.get("/", authCtrl.authenticate, userCtrl.getUser);
  Route.put("/profile", authCtrl.authenticate, userCtrl.updateProfile);
  Route.put("/password", authCtrl.authenticate, userCtrl.updatePassword);
  Route.post("/forget-password", userCtrl.forgetPassword);
  Route.post("/verify-otp", userCtrl.verifyOtp);
  Route.post("/reset-password", userCtrl.resetPassword);
  Route.get("/all-users", authCtrl.authenticateAdmin, userCtrl.getAllUsers);
  Route.get(
    "/practitioners",
    authCtrl.authenticateAdmin,
    userCtrl.getPractitionerUsers,
  );
  // Admin User Management Routes
  Route.post(
    "/create-user",
    authCtrl.authenticateAdmin,
    userCtrl.createUserByAdmin,
  );
  // Primary (active) toggle-status path
  Route.patch(
    "/active/:id/toggle-status",
    authCtrl.authenticateAdmin,
    userCtrl.toggleUserStatus,
  );
  // Backward-compatible toggle-status path (no /active prefix)
  Route.put(
    "/:id/toggle-status",
    authCtrl.authenticateAdmin,
    userCtrl.toggleUserStatus,
  );
  Route.put(
    "/:id/update-credentials",
    authCtrl.authenticateAdmin,
    userCtrl.updateUserCredentials,
  );
});

app.group("/case", (Route) => {
  Route.post("/", authCtrl.authenticateAdmin, caseCtrl.createCase);
  Route.post("/self", authCtrl.authenticate, caseCtrl.createCaseSelf);
  Route.get("/", authCtrl.authenticateAdmin, caseCtrl.getAllCases);
  Route.get("/my-cases", authCtrl.authenticate, caseCtrl.getMyCases);
  Route.get("/:id", authCtrl.authenticate, caseCtrl.getCaseById);
  Route.get("/:caseId/export", authCtrl.authenticate, caseCtrl.exportCase);
  Route.put("/:id", authCtrl.authenticateAdmin, caseCtrl.updateCase);
  Route.delete("/:id", authCtrl.authenticateAdmin, caseCtrl.deleteCase);
  Route.get(
    "/:caseId/timeline",
    authCtrl.authenticate,
    caseTimelineCtrl.getCaseTimeline,
  );
});

app.group("/session", (Route) => {
  Route.post("/", authCtrl.authenticate, sessionCtrl.createSession);
  Route.get(
    "/case/:caseId",
    authCtrl.authenticate,
    sessionCtrl.getSessionsByCase,
  );
  Route.get("/recent", authCtrl.authenticate, sessionCtrl.getRecentSessions);
  Route.get(
    "/all/list",
    authCtrl.authenticateAdmin,
    sessionCtrl.getAllSessions,
  );
  Route.get("/:id", authCtrl.authenticate, sessionCtrl.getSessionById);
  Route.put("/:id", authCtrl.authenticate, sessionCtrl.updateSession);
  Route.post(
    "/:id/start-recording",
    authCtrl.authenticate,
    sessionCtrl.startRecording,
  );
  Route.post(
    "/:id/stop-recording",
    authCtrl.authenticate,
    sessionCtrl.stopRecording,
  );
  Route.post(
    "/:id/upload-recording",
    authCtrl.authenticate,
    upload.single("audio"),
    sessionCtrl.uploadRecording,
  );
  Route.get(
    "/:id/audio-url",
    authCtrl.authenticate,
    sessionCtrl.getPresignedAudioUrl,
  );
  Route.delete("/:id", authCtrl.authenticate, sessionCtrl.deleteSession);
});

app.group("/file", (Route) => {
  Route.post(
    "/upload",
    authCtrl.authenticate,
    upload.single("file"),
    fileCtrl.uploadFile,
  );
  Route.get("/case/:caseId", authCtrl.authenticate, fileCtrl.getFilesByCase);
  Route.get("/:id", authCtrl.authenticate, fileCtrl.getFileById);
  Route.get(
    "/:id/presign",
    authCtrl.authenticate,
    fileCtrl.getPresignedFileUrl,
  );
  Route.delete("/:id", authCtrl.authenticate, fileCtrl.deleteFile);
});

app.group("/timeline-summary", (Route) => {
  Route.post(
    "/",
    authCtrl.authenticate,
    timelineSummaryCtrl.createTimelineSummary,
  );
  Route.post(
    "/generate-with-ai",
    authCtrl.authenticate,
    timelineSummaryCtrl.generateTimelineSummaryWithAI,
  );
  Route.get(
    "/case/:caseId/data",
    authCtrl.authenticate,
    timelineSummaryCtrl.getCaseDataForSummary,
  );
  Route.get(
    "/case/:caseId",
    authCtrl.authenticate,
    timelineSummaryCtrl.getTimelineSummariesByCase,
  );
  Route.get(
    "/:id",
    authCtrl.authenticate,
    timelineSummaryCtrl.getTimelineSummaryById,
  );
  Route.put(
    "/:id",
    authCtrl.authenticate,
    timelineSummaryCtrl.updateTimelineSummary,
  );
  Route.post(
    "/:id/approve",
    authCtrl.authenticate,
    timelineSummaryCtrl.approveTimelineSummary,
  );
  Route.delete(
    "/:id",
    authCtrl.authenticate,
    timelineSummaryCtrl.deleteTimelineSummary,
  );
});

app.group("/soap", (Route) => {
  Route.post("/", authCtrl.authenticate, soapCtrl.createSoapNote);
  Route.post(
    "/generate",
    authCtrl.authenticate,
    soapCtrl.generateSoapNoteFromTranscript,
  );
  Route.get(
    "/session/:sessionId",
    authCtrl.authenticate,
    soapCtrl.getSoapNotesBySession,
  );
  Route.get("/:id", authCtrl.authenticate, soapCtrl.getSoapNoteById);
  Route.put("/:id", authCtrl.authenticate, soapCtrl.updateSoapNote);
  Route.post("/:id/approve", authCtrl.authenticate, soapCtrl.approveSoapNote);
  Route.delete("/:id", authCtrl.authenticate, soapCtrl.deleteSoapNote);
});

app.group("/transcript", (Route) => {
  Route.post("/", authCtrl.authenticate, transcriptCtrl.createTranscript);
  Route.get(
    "/session/:sessionId",
    authCtrl.authenticate,
    transcriptCtrl.getTranscriptBySession,
  );
  Route.get("/:id", authCtrl.authenticate, transcriptCtrl.getTranscriptById);
  Route.put("/:id", authCtrl.authenticate, transcriptCtrl.updateTranscript);
  Route.delete("/:id", authCtrl.authenticate, transcriptCtrl.deleteTranscript);
});

app.group("/audit-logs", (Route) => {
  Route.get("/", authCtrl.authenticate, auditLogCtrl.getAllAuditLogs);
  Route.get(
    "/export",
    authCtrl.authenticateAdmin,
    auditLogCtrl.exportAuditLogs,
  );
  Route.get(
    "/case/:caseId",
    authCtrl.authenticateAdmin,
    auditLogCtrl.getCaseAuditLogs,
  );
  Route.get(
    "/user/:userId",
    authCtrl.authenticateAdmin,
    auditLogCtrl.getUserAuditLogs,
  );
  Route.get(
    "/session/:sessionId",
    authCtrl.authenticateAdmin,
    auditLogCtrl.getSessionAuditLogs,
  );
});
app.group("/backup", (Route) => {
  Route.get("/", authCtrl.authenticateAdmin, backupCtrl.backupAllData);
});

app.group("/data-retention", (Route) => {
  Route.post(
    "/run-check",
    authCtrl.authenticateAdmin,
    dataRetentionCtrl.runRetentionCheck,
  );
  Route.get(
    "/summary",
    authCtrl.authenticateAdmin,
    dataRetentionCtrl.getRetentionSummary,
  );
  Route.get(
    "/session/:sessionId/status",
    authCtrl.authenticate,
    dataRetentionCtrl.getSessionRetentionStatus,
  );
});

module.exports = app;
