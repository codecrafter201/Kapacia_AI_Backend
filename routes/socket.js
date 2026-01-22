"use strict";

let jwt = require("jsonwebtoken");
let mongoose = require("mongoose");
let User = mongoose.model("User");
const transcriptionService = require("../app/Services/TranscriptionService");

const base64id = require("base64id");

let config = {};
config.app = require("../config/app");

/* Controllers */
let socketCtrl = require("../app/Http/Controllers/v1/SocketController");

/*
|--------------------------------------------------------------------------
| Reuse SocketId
|--------------------------------------------------------------------------
|
| Override thw actuall socket.io engine gernerate Id function
| If user pass the existing socket id it will override the existing one.
|
*/

io.engine.generateId = (req) => {
  let query = require("url").parse(req.url, true).query;
  const prevId = query["socketId"];
  // prevId is either a valid id or an empty string
  if (prevId) {
    return prevId;
  }
  return base64id.generateId();
};

/*
|--------------------------------------------------------------------------
| Socket Routes
|--------------------------------------------------------------------------
|
| Here is where you can register Socket routes for your application. These
| routes are loaded by the RouteServiceProvider within a group which
| is assigned the "socket" middleware group. Enjoy building your Socket Paths!
|
*/

io.use(function (socket, next) {
  // Check for token in query (legacy) or auth handshake
  const token = socket.handshake.query?.token || socket.handshake.auth?.token;

  if (!token) {
    return next(new Error("Authentication error"));
  }

  jwt.verify(token, config.app.key, function (err, decoded) {
    if (err) {
      return next(new Error("Authentication error"));
    }

    User.findById(decoded._id, function (err, user) {
      if (err) {
        return next(new Error("Authentication error"));
      }
      socket.decoded = decoded;
      next();
    });
  });
}).on("connect", function (socket) {
  console.log("User Connected: ", socket.id);
  console.log("User Profile: ", socket.decoded);

  const sessionId =
    socket.handshake.auth?.sessionId || socket.handshake.query?.sessionId;

  // Handle transcription start
  socket.on("start-transcription", async (options = {}) => {
    try {
      console.log(`Start transcription request for session: ${sessionId}`);

      if (!sessionId) {
        socket.emit("transcription-error", "Session ID is required");
        return;
      }

      await transcriptionService.startTranscription(sessionId, socket, options);

      socket.emit("transcript", {
        type: "status",
        status: "Transcription ready - send audio to begin",
      });
    } catch (error) {
      console.error("Error starting transcription:", error);
      socket.emit("transcription-error", error.message);
    }
  });

  // Handle audio chunks
  socket.on("audio-chunk", (audioData) => {
    try {
      if (!sessionId) {
        console.warn("[Socket] Received audio chunk without session ID");
        socket.emit("transcription-error", "Session ID is required");
        return;
      }

      // Convert ArrayBuffer to Buffer if needed
      const audioBuffer = Buffer.isBuffer(audioData)
        ? audioData
        : Buffer.from(audioData);

      console.log(
        `[Socket ${sessionId}] Received PCM audio chunk: ${audioBuffer.length} bytes`,
      );

      // Process audio chunk
      transcriptionService.processAudioChunk(sessionId, audioBuffer);
    } catch (error) {
      console.error("[Socket] Error processing audio chunk:", error);
      socket.emit("transcription-error", error.message);
    }
  });

  // Handle transcription stop
  socket.on("stop-transcription", () => {
    try {
      console.log(`Stop transcription request for session: ${sessionId}`);

      if (!sessionId) {
        socket.emit("transcription-error", "Session ID is required");
        return;
      }

      transcriptionService.stopTranscription(sessionId);
    } catch (error) {
      console.error("Error stopping transcription:", error);
      socket.emit("transcription-error", error.message);
    }
  });

  socket.on("disconnect", function () {
    console.log("User Disconnected: ", socket.id);

    // Clean up transcription session on disconnect
    if (sessionId && transcriptionService.isSessionActive(sessionId)) {
      console.log(
        `Cleaning up transcription for disconnected session: ${sessionId}`,
      );
      transcriptionService.stopTranscription(sessionId);
    }
  });
});

io.of("/admin")
  .use(function (socket, next) {
    next();
  })
  .on("connect", (socket) => {
    console.log(Object.keys(io.sockets.connected).length);
    socket.on("stats", () => {
      socketCtrl.stats(socket);
    });
  });
