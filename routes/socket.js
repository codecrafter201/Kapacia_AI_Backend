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

  // Handle transcription start with HTTP/2 error handling
  socket.on("start-transcription", async (options = {}) => {
    try {
      console.log(`Start transcription request for session: ${sessionId}`);

      if (!sessionId) {
        socket.emit("transcription-error", "Session ID is required");
        return;
      }

      // Fetch session to get PII masking preference
      const Session = mongoose.model("Session");
      const session = await Session.findById(sessionId);

      if (!session) {
        socket.emit("transcription-error", "Session not found");
        return;
      }

      // CRITICAL FIX: Start with basic connection first, then add PII if needed
      let transcriptionOptions = {
        ...options,
        languageCode: "en-US",
        sampleRate: 16000,
        showSpeakerLabel: true,
        enablePiiRedaction: false, // Start without PII
      };

      console.log(`[${sessionId}] Starting transcription with options:`, transcriptionOptions);

      try {
        await transcriptionService.startTranscription(
          sessionId,
          socket,
          transcriptionOptions,
        );

        // If basic connection works and PII was requested, try with PII
        if (session.piiMaskingEnabled || options.enablePiiRedaction) {
          console.log(`[${sessionId}] Basic connection successful, now trying with PII...`);
          
          // Stop current session
          transcriptionService.stopTranscription(sessionId);
          
          // Wait a moment
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Retry with PII
          transcriptionOptions.enablePiiRedaction = true;
          await transcriptionService.startTranscription(
            sessionId,
            socket,
            transcriptionOptions,
          );
        }

        socket.emit("transcript", {
          type: "status",
          status: "Transcription ready - send audio to begin",
        });

      } catch (error) {
        console.error(`[${sessionId}] Transcription start failed:`, error);
        
        // CRITICAL: Always send ready status even if AWS fails
        // This allows audio to flow to the backend for debugging
        socket.emit("transcript", {
          type: "status",
          status: "Transcription ready (AWS connection failed, audio will be logged) - send audio to begin",
        });
        
        // If it's an HTTP/2 error and we haven't tried without PII, try that
        if (error.message?.includes('HTTP/2') && transcriptionOptions.enablePiiRedaction) {
          console.log(`[${sessionId}] HTTP/2 error with PII, retrying without PII...`);
          transcriptionOptions.enablePiiRedaction = false;
          
          try {
            await transcriptionService.startTranscription(
              sessionId,
              socket,
              transcriptionOptions,
            );
            
            socket.emit("transcript", {
              type: "status", 
              status: "Transcription ready (PII disabled due to connection issues) - send audio to begin",
            });
          } catch (retryError) {
            // Even if retry fails, allow audio flow for debugging
            socket.emit("transcript", {
              type: "status",
              status: "Transcription ready (AWS failed, audio logging only) - send audio to begin",
            });
            console.error(`[${sessionId}] Retry also failed:`, retryError.message);
          }
        }
        
        // Don't throw error - let audio flow for debugging
        console.log(`[${sessionId}] Continuing with audio logging despite AWS failure`);
        
        // Create dummy session for audio logging
        transcriptionService.createDummySession(sessionId, socket);
      }

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
