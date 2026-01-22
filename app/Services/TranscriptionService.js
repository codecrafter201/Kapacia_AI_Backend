"use strict";

const {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} = require("@aws-sdk/client-transcribe-streaming");
const { PassThrough } = require("stream");

/**
 * AWS Transcribe Streaming Service
 * Handles real-time audio transcription using AWS Transcribe
 */
class TranscriptionService {
  constructor() {
    // Validate AWS credentials
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.error(
        "[TranscriptionService] AWS credentials not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY",
      );
    }

    this.client = new TranscribeStreamingClient({
      region: process.env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      requestHandler: {
        requestTimeout: 30000, // 30 second timeout
        connectionTimeout: 10000, // 10 second connection timeout
      },
    });

    this.sessions = new Map();
    console.log(
      `[TranscriptionService] Initialized with region: ${process.env.AWS_REGION || "us-east-1"}`,
    );
  }

  /**
   * Start transcription immediately with audio stream
   */
  async startTranscription(sessionId, socket, options = {}) {
    try {
      console.log(`[${sessionId}] Starting transcription session`);

      // Create audio stream with buffering
      const audioStream = new PassThrough({ 
        highWaterMark: 1024 * 64, // 64KB buffer
        objectMode: false 
      });

      // Configure AWS Transcribe parameters
      const params = {
        LanguageCode: options.languageCode || "en-US",
        MediaSampleRateHertz: options.sampleRate || 16000,
        MediaEncoding: "pcm",
        AudioStream: this.getAudioStream(audioStream),
      };

      // Enhanced speaker diarization settings
      if (options.showSpeakerLabel !== false) {
        params.ShowSpeakerLabel = true;
        params.MaxSpeakerLabels = options.maxSpeakers || 2;

        if (options.enableChannelIdentification) {
          params.EnableChannelIdentification = true;
        }
      }

      // PII REDACTION CONFIGURATION - FIXED
      if (options.enablePiiRedaction) {
        // CRITICAL: ContentIdentificationType and PiiEntityTypes must be used correctly
        params.ContentIdentificationType = "PII";
        
        // Use only supported PII entity types for streaming
        params.PiiEntityTypes = [
          "NAME",
          "ADDRESS",
          "EMAIL", 
          "PHONE",
          "SSN",
          "CREDIT_DEBIT_NUMBER",
          "BANK_ACCOUNT_NUMBER",
        ];

        console.log(
          `[${sessionId}] PII Redaction enabled with entities:`,
          params.PiiEntityTypes,
        );
      }

      console.log(`[${sessionId}] AWS Transcribe config:`, {
        LanguageCode: params.LanguageCode,
        MediaSampleRateHertz: params.MediaSampleRateHertz,
        MediaEncoding: params.MediaEncoding,
        ShowSpeakerLabel: params.ShowSpeakerLabel,
        MaxSpeakerLabels: params.MaxSpeakerLabels,
        ContentIdentificationType: params.ContentIdentificationType,
        PiiEntityTypes: params.PiiEntityTypes,
      });

      // CRITICAL: Initialize session FIRST but mark as NOT ready for audio
      this.sessions.set(sessionId, {
        audioStream,
        socket,
        response: null,
        isActive: false, // NOT active until AWS connection established
        isAwsReady: false, // New flag
        bytesReceived: 0,
        chunksReceived: 0,
        piiRedactionEnabled: options.enablePiiRedaction || false,
        speakerSegments: [],
        speakerTimings: {},
        lastSpeaker: null,
        lastSpeakerTime: null,
        pendingChunks: [], // Buffer chunks until AWS is ready
        connectionTimeout: null,
      });

      // Set connection timeout
      const session = this.sessions.get(sessionId);
      session.connectionTimeout = setTimeout(() => {
        console.error(`[${sessionId}] AWS connection timeout`);
        socket.emit("transcription-error", "AWS connection timeout");
        this.sessions.delete(sessionId);
      }, 30000); // 30 second timeout

      // Start AWS Transcribe stream with enhanced debugging
      console.log(`[${sessionId}] Connecting to AWS Transcribe...`);
      console.log(`[${sessionId}] Parameters:`, JSON.stringify({
        LanguageCode: params.LanguageCode,
        MediaSampleRateHertz: params.MediaSampleRateHertz,
        MediaEncoding: params.MediaEncoding,
        ShowSpeakerLabel: params.ShowSpeakerLabel,
        MaxSpeakerLabels: params.MaxSpeakerLabels,
        ContentIdentificationType: params.ContentIdentificationType,
        PiiEntityTypes: params.PiiEntityTypes,
      }, null, 2));

      const command = new StartStreamTranscriptionCommand(params);
      
      try {
        const response = await this.client.send(command);
        console.log(`[${sessionId}] AWS Transcribe connection established`);

        // Clear timeout
        if (session.connectionTimeout) {
          clearTimeout(session.connectionTimeout);
          session.connectionTimeout = null;
        }

        // Mark session as ready AFTER AWS accepts the connection
        if (session) {
          session.response = response;
          session.isAwsReady = true;
          session.isActive = true;

          // Process any pending chunks that arrived before AWS was ready
          if (session.pendingChunks.length > 0) {
            console.log(
              `[${sessionId}] Processing ${session.pendingChunks.length} pending chunks`,
            );
            for (const chunk of session.pendingChunks) {
              if (session.audioStream && session.audioStream.writable) {
                session.audioStream.write(chunk);
              }
            }
            session.pendingChunks = [];
          }
        }

        console.log(`[${sessionId}] AWS Transcribe stream fully ready for audio`);

        // Process transcription results
        this.processTranscriptionStream(
          sessionId,
          response.TranscriptResultStream,
        );

        // Notify client
        socket.emit("transcript", {
          type: "status",
          status: options.enablePiiRedaction
            ? "Transcription started with PII masking - speak now"
            : "Transcription started - speak now",
        });

        return { success: true };
        
      } catch (awsError) {
        // Clear timeout on AWS error
        if (session.connectionTimeout) {
          clearTimeout(session.connectionTimeout);
        }
        
        // Enhanced error handling for HTTP/2 errors
        console.error(`[${sessionId}] AWS Transcribe connection failed:`, {
          name: awsError.name,
          message: awsError.message,
          code: awsError.code,
          statusCode: awsError.$response?.statusCode,
          requestId: awsError.$metadata?.requestId,
        });

        // Specific handling for HTTP/2 stream errors (result code 7 = REFUSED_STREAM)
        if (awsError.message?.includes('HTTP/2') || awsError.message?.includes('stream') || awsError.message?.includes('result code 7')) {
          console.error(`[${sessionId}] HTTP/2 Stream REFUSED_STREAM Error - likely causes:`);
          console.error(`- Invalid PII configuration (most common)`);
          console.error(`- Unsupported audio parameters`);
          console.error(`- AWS service limits exceeded`);
          console.error(`- Network connectivity issues`);
          
          // Try without PII redaction if it was enabled
          if (options.enablePiiRedaction) {
            console.log(`[${sessionId}] Retrying without PII redaction...`);
            const retryOptions = { ...options, enablePiiRedaction: false };
            return this.startTranscription(sessionId, socket, retryOptions);
          }
        }
        
        throw awsError;
      }

    } catch (error) {
      console.error(`[${sessionId}] Failed to start transcription:`, error);

      const errorMsg =
        error.Message || error.message || "Failed to start transcription";
      socket.emit("transcription-error", errorMsg);

      // Log detailed error info
      if (error.$metadata) {
        console.error(`[${sessionId}] AWS Error Metadata:`, error.$metadata);
      }
      if (error.$response) {
        try {
          console.error(
            `[${sessionId}] AWS Raw Response Status:`,
            error.$response.statusCode,
          );
          if (error.$response.body) {
            const raw = await this._streamToString(error.$response.body);
            console.error(`[${sessionId}] AWS Raw Response Body:`, raw);
          }
        } catch (respErr) {
          console.error(
            `[${sessionId}] Failed to read AWS raw response:`,
            respErr,
          );
        }
      }

      // Clean up session on failure
      this.sessions.delete(sessionId);

      throw error;
    }
  }

  /**
   * Process incoming audio chunk
   */
  async processAudioChunk(sessionId, audioChunk) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      console.warn(`[${sessionId}] No active session found for audio chunk`);
      return;
    }

    try {
      const buffer = Buffer.isBuffer(audioChunk)
        ? audioChunk
        : Buffer.from(audioChunk);

      if (buffer.length === 0) {
        console.warn(`[${sessionId}] Received empty audio chunk, skipping`);
        return;
      }

      // Validate PCM format (should be even number of bytes for 16-bit)
      if (buffer.length % 2 !== 0) {
        console.warn(`[${sessionId}] Invalid PCM buffer size: ${buffer.length} bytes`);
        return;
      }

      // CRITICAL FIX: Buffer chunks if AWS is not ready yet (but not for dummy sessions)
      if (!session.isAwsReady && !session.isDummy) {
        console.log(
          `[${sessionId}] AWS not ready yet, buffering chunk (${buffer.length} bytes)`,
        );
        session.pendingChunks.push(buffer);

        // Limit buffer to prevent memory issues (keep last 100 chunks ~800KB)
        if (session.pendingChunks.length > 100) {
          session.pendingChunks.shift();
          console.warn(
            `[${sessionId}] Pending buffer full, dropping oldest chunk`,
          );
        }
        return;
      }

      if (!session.isActive) {
        console.warn(`[${sessionId}] Session not active, ignoring chunk`);
        return;
      }

      if (!session.audioStream || !session.audioStream.writable) {
        console.warn(`[${sessionId}] Audio stream not writable`);
        return;
      }

      session.bytesReceived += buffer.length;
      session.chunksReceived += 1;

      // If this is a dummy session (AWS failed), just log the audio
      if (session.isDummy) {
        console.log(`[${sessionId}] [DUMMY] Received audio chunk: ${buffer.length} bytes (Total: ${session.chunksReceived} chunks, ${Math.round(session.bytesReceived / 1024)}KB)`);
        
        // Log stats every 50 chunks
        if (session.chunksReceived % 50 === 0) {
          console.log(`[${sessionId}] [DUMMY] Audio logging stats: ${session.chunksReceived} chunks, ${Math.round(session.bytesReceived / 1024)}KB total`);
        }
        return;
      }

      const writeSuccess = session.audioStream.write(buffer);

      if (!writeSuccess) {
        console.warn(`[${sessionId}] Audio stream backpressure detected`);
        // Wait for drain event
        await new Promise((resolve) =>
          session.audioStream.once("drain", resolve),
        );
      }

      if (session.chunksReceived % 50 === 0) {
        console.log(
          `[${sessionId}] Stats: ${session.chunksReceived} chunks, ${Math.round(session.bytesReceived / 1024)}KB received`,
        );
      }
    } catch (error) {
      console.error(`[${sessionId}] Error processing audio chunk:`, error);
      session.socket.emit("transcription-error", error.message);
    }
  }

  /**
   * Stop transcription
   */
  stopTranscription(sessionId) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      console.warn(`[${sessionId}] No session to stop`);
      return;
    }

    try {
      console.log(`[${sessionId}] Stopping transcription`);

      // Clear any pending timeout
      if (session.connectionTimeout) {
        clearTimeout(session.connectionTimeout);
        session.connectionTimeout = null;
      }

      // End audio stream gracefully
      if (session.audioStream && session.audioStream.writable) {
        session.audioStream.end();
      }
      session.isActive = false;
      session.isAwsReady = false;

      console.log(
        `[${sessionId}] Final stats: ${session.chunksReceived} chunks, ${Math.round(session.bytesReceived / 1024)}KB total`,
      );

      setTimeout(() => {
        this.sessions.delete(sessionId);
        console.log(`[${sessionId}] Session cleaned up`);
      }, 2000);

      session.socket.emit("transcript", {
        type: "complete",
        status: "Transcription stopped",
      });

      return { success: true };
    } catch (error) {
      console.error(`[${sessionId}] Error stopping transcription:`, error);
      throw error;
    }
  }

  /**
   * Generate async iterable audio stream for AWS
   */
  async *getAudioStream(audioStream) {
    try {
      console.log("[Audio Stream] Starting audio stream generator");
      
      for await (const chunk of audioStream) {
        if (chunk && chunk.length > 0) {
          yield { AudioEvent: { AudioChunk: chunk } };
        }
      }
      
      console.log("[Audio Stream] Audio stream generator ended");
    } catch (error) {
      console.error("[Audio Stream] Error in generator:", error);
      // Don't rethrow - let AWS handle the stream end gracefully
    }
  }

  /**
   * Utility: stream body to string for debugging
   */
  async _streamToString(stream) {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf-8");
  }

  /**
   * Process transcription results from AWS
   */
  async processTranscriptionStream(sessionId, stream) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      console.warn(`[${sessionId}] Session not found for result stream`);
      return;
    }

    try {
      console.log(`[${sessionId}] Started processing transcription results`);

      for await (const event of stream) {
        if (event.TranscriptEvent) {
          const results = event.TranscriptEvent.Transcript.Results;

          for (const result of results) {
            if (result.Alternatives && result.Alternatives.length > 0) {
              const alternative = result.Alternatives[0];
              const transcript = alternative.Transcript;
              const isFinal = !result.IsPartial;

              // Extract speaker with enhanced accuracy detection
              let speaker = "Unknown";
              let speakerConfidence = 0;

              if (alternative.Items && alternative.Items.length > 0) {
                const speakerIds = [];
                const confidenceScores = [];

                for (const item of alternative.Items) {
                  if (item.Speaker) {
                    speakerIds.push(item.Speaker);
                    const confidence = item.Type === "speech" ? 1 : 0.7;
                    confidenceScores.push(confidence);
                  }
                }

                if (speakerIds.length > 0) {
                  const speakerCount = {};
                  speakerIds.forEach((id) => {
                    speakerCount[id] = (speakerCount[id] || 0) + 1;
                  });

                  const mostCommonSpeaker = Object.keys(speakerCount).reduce(
                    (a, b) => (speakerCount[a] > speakerCount[b] ? a : b),
                  );

                  speaker = `Speaker ${mostCommonSpeaker}`;
                  speakerConfidence =
                    confidenceScores.reduce((a, b) => a + b, 0) /
                    confidenceScores.length;

                  const currentTime = Date.now();
                  if (speaker !== session.lastSpeaker) {
                    if (session.lastSpeaker && session.lastSpeakerTime) {
                      const duration = currentTime - session.lastSpeakerTime;
                      if (!session.speakerTimings[session.lastSpeaker]) {
                        session.speakerTimings[session.lastSpeaker] = 0;
                      }
                      session.speakerTimings[session.lastSpeaker] += duration;
                    }
                    session.lastSpeaker = speaker;
                    session.lastSpeakerTime = currentTime;
                    session.speakerSegments.push({
                      speaker,
                      time: currentTime,
                      confidence: speakerConfidence,
                    });
                  }
                }
              }

              const minConfidence = 0.5;
              if (speakerConfidence >= minConfidence || speaker !== "Unknown") {
                // Send to frontend with PII status indicator
                session.socket.emit("transcript", {
                  type: "transcript",
                  data: {
                    transcript,
                    isFinal,
                    timestamp: Date.now(),
                    speaker,
                    confidence: speakerConfidence,
                    piiRedacted: session.piiRedactionEnabled,
                  },
                });

                const piiStatus = session.piiRedactionEnabled
                  ? " [PII MASKED]"
                  : "";
                console.log(
                  `[${sessionId}] ${isFinal ? "FINAL" : "partial"}: "${transcript}" (${speaker}, confidence: ${(speakerConfidence * 100).toFixed(0)}%)${piiStatus}`,
                );
              }
            }
          }
        }
      }

      this.postProcessSpeakerTransitions(sessionId, session);

      console.log(`[${sessionId}] Transcription stream ended`);
    } catch (error) {
      console.error(`[${sessionId}] Error processing results:`, error);
      if (session.socket) {
        session.socket.emit("transcription-error", error.message);
      }
    }
  }

  /**
   * Post-process speaker transitions to fix weak diarization
   */
  postProcessSpeakerTransitions(sessionId, session) {
    try {
      if (session.speakerSegments.length < 2) return;

      const segments = session.speakerSegments;
      const mergedSegments = [segments[0]];

      for (let i = 1; i < segments.length; i++) {
        const current = segments[i];
        const previous = mergedSegments[mergedSegments.length - 1];

        const timeDiff = current.time - previous.time;
        const isWeakTransition =
          timeDiff < 2000 &&
          (current.confidence < 0.7 || previous.confidence < 0.7);

        if (isWeakTransition && previous.speaker !== current.speaker) {
          console.log(
            `[${sessionId}] Filtering weak speaker transition: ${previous.speaker} -> ${current.speaker} (${timeDiff}ms, conf: ${(current.confidence * 100).toFixed(0)}%)`,
          );
        } else {
          mergedSegments.push(current);
        }
      }

      console.log(`[${sessionId}] Speaker statistics:`, session.speakerTimings);

      if (mergedSegments.length < segments.length) {
        console.log(
          `[${sessionId}] Post-processing: merged ${segments.length - mergedSegments.length} weak transitions`,
        );
      }
    } catch (error) {
      console.error(`[${sessionId}] Error in post-processing:`, error);
    }
  }

  isSessionActive(sessionId) {
    const session = this.sessions.get(sessionId);
    return session && session.isActive;
  }

  getActiveSessionCount() {
    let count = 0;
    for (const [, session] of this.sessions) {
      if (session.isActive) count++;
    }
    return count;
  }

  cleanup() {
    console.log("Cleaning up all transcription sessions...");
    for (const [sessionId] of this.sessions) {
      this.stopTranscription(sessionId);
    }
  }

  /**
   * Create a dummy session for audio logging when AWS fails
   */
  createDummySession(sessionId, socket) {
    console.log(`[${sessionId}] Creating dummy session for audio logging`);
    
    this.sessions.set(sessionId, {
      audioStream: null,
      socket,
      response: null,
      isActive: true, // Mark as active so audio chunks are accepted
      isAwsReady: true, // CRITICAL: Mark as ready so chunks are processed, not buffered
      bytesReceived: 0,
      chunksReceived: 0,
      piiRedactionEnabled: false,
      speakerSegments: [],
      speakerTimings: {},
      lastSpeaker: null,
      lastSpeakerTime: null,
      pendingChunks: [],
      connectionTimeout: null,
      isDummy: true, // Flag to indicate this is a dummy session
    });
  }
}

module.exports = new TranscriptionService();
