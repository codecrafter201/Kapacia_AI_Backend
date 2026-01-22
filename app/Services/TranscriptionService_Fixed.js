"use strict";

const {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} = require("@aws-sdk/client-transcribe-streaming");
const { PassThrough } = require("stream");

/**
 * AWS Transcribe Streaming Service - FIXED VERSION
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
   * Start transcription with improved error handling and connection management
   */
  async startTranscription(sessionId, socket, options = {}) {
    try {
      console.log(`[${sessionId}] Starting transcription session`);

      // Create audio stream with proper error handling
      const audioStream = new PassThrough({ 
        highWaterMark: 1024 * 32, // Reduced buffer size to 32KB
        objectMode: false 
      });

      // Handle stream errors
      audioStream.on('error', (error) => {
        console.error(`[${sessionId}] Audio stream error:`, error);
        this.handleStreamError(sessionId, error);
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
      }

      // PII REDACTION CONFIGURATION
      if (options.enablePiiRedaction) {
        params.ContentIdentificationType = "PII";
        params.PiiEntityTypes = options.piiEntityTypes || [
          "NAME",
          "ADDRESS", 
          "EMAIL",
          "PHONE",
          "SSN",
          "CREDIT_DEBIT_NUMBER",
          "BANK_ACCOUNT_NUMBER",
          "PIN",
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
      });

      // Initialize session FIRST
      this.sessions.set(sessionId, {
        audioStream,
        socket,
        response: null,
        isActive: false,
        isAwsReady: false,
        bytesReceived: 0,
        chunksReceived: 0,
        piiRedactionEnabled: options.enablePiiRedaction || false,
        speakerSegments: [],
        speakerTimings: {},
        lastSpeaker: null,
        lastSpeakerTime: null,
        pendingChunks: [],
        connectionTimeout: null,
        startTime: Date.now(),
      });

      const session = this.sessions.get(sessionId);

      // Set connection timeout with cleanup
      session.connectionTimeout = setTimeout(() => {
        console.error(`[${sessionId}] AWS connection timeout after 25 seconds`);
        this.handleConnectionTimeout(sessionId);
      }, 25000);

      // Start AWS Transcribe stream with retry logic
      console.log(`[${sessionId}] Connecting to AWS Transcribe...`);
      const command = new StartStreamTranscriptionCommand(params);
      
      let response;
      let retryCount = 0;
      const maxRetries = 2;

      while (retryCount <= maxRetries) {
        try {
          response = await this.client.send(command);
          break; // Success, exit retry loop
        } catch (awsError) {
          retryCount++;
          console.error(`[${sessionId}] AWS connection attempt ${retryCount} failed:`, awsError.message);
          
          if (retryCount > maxRetries) {
            throw awsError; // Final failure
          }
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        }
      }

      console.log(`[${sessionId}] AWS Transcribe connection established after ${retryCount} attempts`);

      // Clear timeout on success
      if (session.connectionTimeout) {
        clearTimeout(session.connectionTimeout);
        session.connectionTimeout = null;
      }

      // Mark session as ready
      session.response = response;
      session.isAwsReady = true;
      session.isActive = true;

      // Process any pending chunks
      if (session.pendingChunks.length > 0) {
        console.log(
          `[${sessionId}] Processing ${session.pendingChunks.length} pending chunks`,
        );
        
        // Process chunks with small delay to avoid overwhelming AWS
        for (let i = 0; i < session.pendingChunks.length; i++) {
          const chunk = session.pendingChunks[i];
          if (session.audioStream && session.audioStream.writable) {
            session.audioStream.write(chunk);
            
            // Small delay between chunks
            if (i < session.pendingChunks.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }
        }
        session.pendingChunks = [];
      }

      console.log(`[${sessionId}] AWS Transcribe stream fully ready for audio`);

      // Process transcription results
      this.processTranscriptionStream(sessionId, response.TranscriptResultStream);

      // Notify client
      socket.emit("transcript", {
        type: "status",
        status: options.enablePiiRedaction
          ? "Transcription started with PII masking - speak now"
          : "Transcription started - speak now",
      });

      return { success: true };

    } catch (error) {
      console.error(`[${sessionId}] Failed to start transcription:`, error);
      this.handleStartupError(sessionId, error);
      throw error;
    }
  }

  /**
   * Handle connection timeout
   */
  handleConnectionTimeout(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.socket.emit("transcription-error", "AWS connection timeout - please try again");
    this.sessions.delete(sessionId);
  }

  /**
   * Handle startup errors
   */
  handleStartupError(sessionId, error) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Clear timeout
    if (session.connectionTimeout) {
      clearTimeout(session.connectionTimeout);
    }

    const errorMsg = this.getErrorMessage(error);
    session.socket.emit("transcription-error", errorMsg);

    // Log detailed error info
    this.logDetailedError(sessionId, error);

    // Clean up session
    this.sessions.delete(sessionId);
  }

  /**
   * Get user-friendly error message
   */
  getErrorMessage(error) {
    if (error.name === 'TimeoutError') {
      return "Connection timeout - please check your internet connection and try again";
    }
    if (error.name === 'ThrottlingException') {
      return "Service temporarily unavailable - please wait a moment and try again";
    }
    if (error.name === 'LimitExceededException') {
      return "Service limit reached - please try again later";
    }
    return error.Message || error.message || "Failed to start transcription";
  }

  /**
   * Log detailed error information
   */
  logDetailedError(sessionId, error) {
    if (error.$metadata) {
      console.error(`[${sessionId}] AWS Error Metadata:`, error.$metadata);
    }
    if (error.$response) {
      console.error(`[${sessionId}] AWS Response Status:`, error.$response.statusCode);
    }
  }

  /**
   * Handle stream errors
   */
  handleStreamError(sessionId, error) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    console.error(`[${sessionId}] Stream error:`, error);
    session.socket.emit("transcription-error", "Audio stream error - please restart transcription");
  }

  /**
   * Process incoming audio chunk with improved validation
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

      // Buffer chunks if AWS is not ready yet
      if (!session.isAwsReady) {
        session.pendingChunks.push(buffer);
        
        // Limit buffer to prevent memory issues
        if (session.pendingChunks.length > 100) {
          session.pendingChunks.shift();
          console.warn(`[${sessionId}] Pending buffer full, dropping oldest chunk`);
        }
        
        console.log(
          `[${sessionId}] AWS not ready yet, buffering chunk ${session.pendingChunks.length} (${buffer.length} bytes)`,
        );
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

      // Write with backpressure handling
      const writeSuccess = session.audioStream.write(buffer);

      if (!writeSuccess) {
        console.warn(`[${sessionId}] Audio stream backpressure detected`);
        // Wait for drain event with timeout
        await Promise.race([
          new Promise((resolve) => session.audioStream.once("drain", resolve)),
          new Promise((resolve) => setTimeout(resolve, 1000)) // 1 second timeout
        ]);
      }

      // Log stats periodically
      if (session.chunksReceived % 100 === 0) {
        const elapsed = Date.now() - session.startTime;
        const rate = (session.bytesReceived / 1024) / (elapsed / 1000);
        console.log(
          `[${sessionId}] Stats: ${session.chunksReceived} chunks, ${Math.round(session.bytesReceived / 1024)}KB received, ${rate.toFixed(1)} KB/s`,
        );
      }

    } catch (error) {
      console.error(`[${sessionId}] Error processing audio chunk:`, error);
      session.socket.emit("transcription-error", "Audio processing error");
    }
  }

  /**
   * Stop transcription with proper cleanup
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

      const elapsed = Date.now() - session.startTime;
      console.log(
        `[${sessionId}] Final stats: ${session.chunksReceived} chunks, ${Math.round(session.bytesReceived / 1024)}KB total, ${Math.round(elapsed / 1000)}s duration`,
      );

      // Clean up session after delay
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
   * Generate async iterable audio stream for AWS with error handling
   */
  async *getAudioStream(audioStream) {
    try {
      console.log("[Audio Stream] Starting audio stream generator");
      
      for await (const chunk of audioStream) {
        if (chunk && chunk.length > 0) {
          yield { AudioEvent: { AudioChunk: chunk } };
        }
      }
      
      console.log("[Audio Stream] Audio stream generator ended normally");
    } catch (error) {
      console.error("[Audio Stream] Error in generator:", error);
      // Don't rethrow - let AWS handle the stream end gracefully
    }
  }

  /**
   * Process transcription results with improved error handling
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
        if (!session.isActive) {
          console.log(`[${sessionId}] Session no longer active, stopping result processing`);
          break;
        }

        if (event.TranscriptEvent) {
          const results = event.TranscriptEvent.Transcript.Results;

          for (const result of results) {
            if (result.Alternatives && result.Alternatives.length > 0) {
              const alternative = result.Alternatives[0];
              const transcript = alternative.Transcript;
              const isFinal = !result.IsPartial;

              if (!transcript || transcript.trim().length === 0) {
                continue; // Skip empty transcripts
              }

              // Extract speaker information
              let speaker = "Unknown";
              let speakerConfidence = 0;

              if (alternative.Items && alternative.Items.length > 0) {
                const speakerData = this.extractSpeakerInfo(alternative.Items);
                speaker = speakerData.speaker;
                speakerConfidence = speakerData.confidence;

                // Update speaker tracking
                this.updateSpeakerTracking(session, speaker, speakerConfidence);
              }

              // Send to frontend
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

              const piiStatus = session.piiRedactionEnabled ? " [PII MASKED]" : "";
              console.log(
                `[${sessionId}] ${isFinal ? "FINAL" : "partial"}: "${transcript}" (${speaker}, confidence: ${(speakerConfidence * 100).toFixed(0)}%)${piiStatus}`,
              );
            }
          }
        }
      }

      console.log(`[${sessionId}] Transcription stream ended`);
    } catch (error) {
      console.error(`[${sessionId}] Error processing results:`, error);
      if (session.socket) {
        session.socket.emit("transcription-error", "Transcription processing error");
      }
    }
  }

  /**
   * Extract speaker information from transcript items
   */
  extractSpeakerInfo(items) {
    const speakerIds = [];
    const confidenceScores = [];

    for (const item of items) {
      if (item.Speaker) {
        speakerIds.push(item.Speaker);
        const confidence = item.Type === "speech" ? 1 : 0.7;
        confidenceScores.push(confidence);
      }
    }

    if (speakerIds.length === 0) {
      return { speaker: "Unknown", confidence: 0 };
    }

    // Find most common speaker
    const speakerCount = {};
    speakerIds.forEach((id) => {
      speakerCount[id] = (speakerCount[id] || 0) + 1;
    });

    const mostCommonSpeaker = Object.keys(speakerCount).reduce(
      (a, b) => (speakerCount[a] > speakerCount[b] ? a : b),
    );

    const speaker = `Speaker ${mostCommonSpeaker}`;
    const confidence = confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length;

    return { speaker, confidence };
  }

  /**
   * Update speaker tracking
   */
  updateSpeakerTracking(session, speaker, confidence) {
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
        confidence,
      });
    }
  }

  /**
   * Utility methods
   */
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
}

module.exports = new TranscriptionService();