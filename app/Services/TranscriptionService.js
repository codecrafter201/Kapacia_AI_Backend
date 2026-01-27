"use strict";

const {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} = require("@aws-sdk/client-transcribe-streaming");
const { PassThrough } = require("stream");
const mongoose = require("mongoose");
const Transcript = mongoose.model("Transcript");
const Session = mongoose.model("Session");

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
    });

    this.sessions = new Map();
  }

  /**
   * Map frontend language to AWS Transcribe language code
   */
  getAWSLanguageCode(language) {
    const languageMap = {
      english: "en-US",
      mandarin: "zh-CN", // Mandarin Chinese
    };
    return languageMap[language] || "en-US"; // Default to English
  }

  /**
   * Start transcription immediately with audio stream
   */
  async startTranscription(sessionId, socket, options = {}) {
    // Declare piiMaskingEnabled and language outside try block for proper scope
    let piiMaskingEnabled = false;
    let languageCode = "en-US";
    let sessionLanguage = "english";

    try {
      console.log(`[${sessionId}] Starting transcription session`);

      // Get session data to check PII masking settings and language
      const Session = mongoose.model("Session");
      const sessionData = await Session.findById(sessionId);
      piiMaskingEnabled = sessionData?.piiMaskingEnabled !== false;
      sessionLanguage = sessionData?.language || "english";
      languageCode = this.getAWSLanguageCode(sessionLanguage);

      console.log(
        `[${sessionId}] Session language: ${sessionLanguage} (AWS code: ${languageCode}), PII redaction enabled: ${piiMaskingEnabled}`,
      );

      // Create audio stream
      const audioStream = new PassThrough();

      // Configure AWS Transcribe parameters with PII redaction
      const params = {
        LanguageCode: languageCode,
        MediaSampleRateHertz: options.sampleRate || 16000,
        MediaEncoding: "pcm", // CRITICAL: Must be PCM for raw audio
        AudioStream: this.getAudioStream(audioStream),
      };

      // Add AWS PII redaction if enabled
      if (piiMaskingEnabled) {
        params.ContentRedactionType = "PII";
        // Don't specify PiiEntityTypes - let AWS redact all PII types by default
        // This is more reliable for streaming transcription

        console.log(
          `[${sessionId}] AWS PII redaction configured (all PII types)`,
        );
      }

      // Enhanced speaker diarization settings for better accuracy
      if (options.showSpeakerLabel !== false) {
        params.ShowSpeakerLabel = true;

        // Set exact number of speakers for better accuracy (default: 2)
        params.MaxSpeakerLabels = options.maxSpeakers || 2;

        // Enable channel identification if stereo/multi-channel audio
        if (options.enableChannelIdentification) {
          params.EnableChannelIdentification = true;
        }
      }

      console.log(`[${sessionId}] AWS Transcribe config:`, {
        LanguageCode: params.LanguageCode,
        MediaSampleRateHertz: params.MediaSampleRateHertz,
        MediaEncoding: params.MediaEncoding,
        ShowSpeakerLabel: params.ShowSpeakerLabel,
        MaxSpeakerLabels: params.MaxSpeakerLabels,
        EnableChannelIdentification: params.EnableChannelIdentification,
        ContentRedactionType: params.ContentRedactionType || "None",
        PiiRedactionEnabled: !!params.ContentRedactionType,
      });

      // Prepare session before calling AWS so early audio chunks are not dropped
      this.sessions.set(sessionId, {
        audioStream,
        socket,
        response: null,
        // Accept audio immediately; if AWS fails we clean up below
        isActive: true,
        bytesReceived: 0,
        chunksReceived: 0,
        language: sessionLanguage,
        piiMaskingEnabled,
        awsPiiRedactionEnabled: piiMaskingEnabled,
        // Speaker tracking for post-processing
        speakerSegments: [], // Track speaker changes
        speakerTimings: {}, // Track speaker durations
        lastSpeaker: null,
        lastSpeakerTime: null,
        // PII tracking (AWS will handle the actual redaction)
        piiDetectedCount: 0,
        piiEntitiesByType: {},
      });

      // Start AWS Transcribe stream immediately
      const command = new StartStreamTranscriptionCommand(params);
      const response = await this.client.send(command);

      // Mark session active after AWS accepts the stream
      const session = this.sessions.get(sessionId);
      if (session) {
        session.response = response;
        session.isActive = true;
      }

      console.log(
        `[${sessionId}] AWS Transcribe stream started successfully with PII redaction: ${piiMaskingEnabled}`,
      );

      // Process transcription results
      this.processTranscriptionStream(
        sessionId,
        response.TranscriptResultStream,
      );

      // Notify client
      socket.emit("transcript", {
        type: "status",
        status: "Transcription started - speak now",
        piiMaskingEnabled,
        awsPiiRedactionEnabled: piiMaskingEnabled,
      });

      return { success: true };
    } catch (error) {
      console.error(`[${sessionId}] Failed to start transcription:`, error);

      // Check if this is a PII redaction related error
      if (
        piiMaskingEnabled &&
        (error.message?.includes("PII") ||
          error.message?.includes("ContentRedaction"))
      ) {
        console.error(
          `[${sessionId}] PII redaction error detected. Trying without PII redaction...`,
        );

        // Try again without PII redaction as fallback
        try {
          const fallbackParams = { ...params };
          delete fallbackParams.ContentRedactionType;
          delete fallbackParams.PiiEntityTypes;

          console.log(`[${sessionId}] Retrying without PII redaction...`);
          const fallbackCommand = new StartStreamTranscriptionCommand(
            fallbackParams,
          );
          const fallbackResponse = await this.client.send(fallbackCommand);

          const session = this.sessions.get(sessionId);
          if (session) {
            session.response = fallbackResponse;
            session.isActive = true;
            session.awsPiiRedactionEnabled = false; // Mark as disabled
          }

          console.log(
            `[${sessionId}] Fallback transcription started successfully (PII redaction disabled)`,
          );

          this.processTranscriptionStream(
            sessionId,
            fallbackResponse.TranscriptResultStream,
          );

          socket.emit("transcript", {
            type: "status",
            status: "Transcription started - PII redaction unavailable",
            piiMaskingEnabled: false,
            awsPiiRedactionEnabled: false,
            fallbackMode: true,
          });

          return { success: true, fallbackMode: true };
        } catch (fallbackError) {
          console.error(`[${sessionId}] Fallback also failed:`, fallbackError);
        }
      }

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

    if (!session.isActive) {
      console.warn(`[${sessionId}] Session not active, ignoring chunk`);
      return;
    }

    if (!session.audioStream || !session.audioStream.writable) {
      console.warn(`[${sessionId}] Audio stream not writable`);
      return;
    }

    try {
      // Convert to Buffer if needed
      const buffer = Buffer.isBuffer(audioChunk)
        ? audioChunk
        : Buffer.from(audioChunk);

      // Validate buffer size
      if (buffer.length === 0) {
        console.warn(`[${sessionId}] Received empty audio chunk, skipping`);
        return;
      }

      // Update stats
      session.bytesReceived += buffer.length;
      session.chunksReceived += 1;

      // Write to AWS stream
      const writeSuccess = session.audioStream.write(buffer);

      if (!writeSuccess) {
        console.warn(`[${sessionId}] Audio stream backpressure detected`);
      }

      // Log every 10 chunks
      if (session.chunksReceived % 10 === 0) {
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

      // End audio stream
      session.audioStream.end();
      session.isActive = false;

      // Log final stats
      console.log(
        `[${sessionId}] Final stats: ${session.chunksReceived} chunks, ${Math.round(session.bytesReceived / 1024)}KB total`,
      );

      // Clean up after delay (allow final transcripts)
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
    for await (const chunk of audioStream) {
      yield { AudioEvent: { AudioChunk: chunk } };
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
                // Collect all speaker IDs from items
                const speakerIds = [];
                const confidenceScores = [];

                for (const item of alternative.Items) {
                  if (item.Speaker) {
                    speakerIds.push(item.Speaker);
                    // Estimate confidence (1 if speech item, lower if other)
                    const confidence = item.Type === "speech" ? 1 : 0.7;
                    confidenceScores.push(confidence);
                  }
                }

                if (speakerIds.length > 0) {
                  // Use most common speaker ID (majority voting for accuracy)
                  const speakerCount = {};
                  speakerIds.forEach((id) => {
                    speakerCount[id] = (speakerCount[id] || 0) + 1;
                  });

                  const mostCommonSpeaker = Object.keys(speakerCount).reduce(
                    (a, b) => (speakerCount[a] > speakerCount[b] ? a : b),
                  );

                  speaker = `Speaker ${mostCommonSpeaker}`;
                  // Calculate average confidence
                  speakerConfidence =
                    confidenceScores.reduce((a, b) => a + b, 0) /
                    confidenceScores.length;

                  // Track speaker segments for post-processing
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

              // Only emit if confidence is adequate (filter weak detections)
              const minConfidence = 0.5;
              if (speakerConfidence >= minConfidence || speaker !== "Unknown") {
                // AWS Transcribe already handles PII redaction if enabled
                // The transcript will contain [PII] markers where PII was detected
                const piiDetected = transcript.includes("[PII]");

                if (piiDetected && session.awsPiiRedactionEnabled) {
                  // Count PII instances for statistics
                  const piiCount = (transcript.match(/\[PII\]/g) || []).length;
                  session.piiDetectedCount += piiCount;

                  console.log(
                    `[${sessionId}] AWS PII redaction applied: ${piiCount} entities masked in this segment`,
                  );
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
                    piiDetected,
                    piiMasked: session.awsPiiRedactionEnabled && piiDetected,
                    awsPiiRedaction: session.awsPiiRedactionEnabled,
                  },
                });

                // Persist final transcripts while recording so data is not lost on disconnect
                if (isFinal) {
                  this.persistTranscriptSegment(sessionId, {
                    transcript,
                    speaker,
                    timestamp: Date.now(),
                    piiDetected,
                  });
                }

                const piiStatus = piiDetected ? ", AWS PII redacted" : "";
                console.log(
                  `[${sessionId}] ${isFinal ? "FINAL" : "partial"}: "${transcript}" (${speaker}, confidence: ${(speakerConfidence * 100).toFixed(0)}%${piiStatus})`,
                );
              }
            }
          }
        }
      }

      // Post-processing: merge weak speaker transitions
      this.postProcessSpeakerTransitions(sessionId, session);

      console.log(`[${sessionId}] Transcription stream ended`);
    } catch (error) {
      console.error(`[${sessionId}] Error processing results:`, error);
      if (session.socket) {
        session.socket.emit("transcription-error", error.message);
      }
    }
  }

  async persistTranscriptSegment(
    sessionId,
    { transcript, speaker, timestamp, piiDetected },
  ) {
    try {
      const sessionState = this.sessions.get(sessionId);

      // Fallback fetch if state is missing (e.g., service restart)
      let language = sessionState?.language || "english";
      let piiMaskingEnabled = sessionState?.piiMaskingEnabled !== false;

      if (!sessionState) {
        const sessionDoc = await Session.findById(sessionId).select(
          "language piiMaskingEnabled",
        );
        if (sessionDoc) {
          language = sessionDoc.language || language;
          if (typeof sessionDoc.piiMaskingEnabled === "boolean") {
            piiMaskingEnabled = sessionDoc.piiMaskingEnabled;
          }
        }
      }

      const text = transcript || "";
      const isoTimestamp = new Date(timestamp || Date.now()).toISOString();

      const segment = {
        text,
        speaker: speaker || "Unknown",
        timestamp: isoTimestamp,
        isFinal: true,
      };

      const wordCountIncrement = text.split(/\s+/).filter(Boolean).length;
      const piiCount = (text.match(/\[PII\]/g) || []).length;
      const hasPii = piiDetected || piiCount > 0;

      let transcriptDoc = await Transcript.findOne({ session: sessionId });

      if (!transcriptDoc) {
        transcriptDoc = new Transcript({
          session: sessionId,
          rawText: `[${isoTimestamp}] ${segment.speaker}: ${text}`,
          editedText: null,
          isEdited: false,
          piiMaskingEnabled,
          hasPii,
          piiMaskingMetadata: hasPii
            ? {
                awsPiiRedaction: true,
                totalEntitiesMasked: piiCount,
                processedAt: new Date().toISOString(),
                redactionMethod: "AWS_TRANSCRIBE_STREAMING",
              }
            : null,
          wordCount: wordCountIncrement,
          languageDetected: language,
          confidenceScore: null,
          segments: [segment],
          status: "Draft",
        });
      } else {
        transcriptDoc.rawText = transcriptDoc.rawText
          ? `${transcriptDoc.rawText}\n[${isoTimestamp}] ${segment.speaker}: ${text}`
          : `[${isoTimestamp}] ${segment.speaker}: ${text}`;
        transcriptDoc.wordCount =
          (transcriptDoc.wordCount || 0) + wordCountIncrement;
        transcriptDoc.languageDetected =
          transcriptDoc.languageDetected || language;
        transcriptDoc.piiMaskingEnabled = piiMaskingEnabled;
        transcriptDoc.hasPii = transcriptDoc.hasPii || hasPii;

        if (hasPii) {
          const existingMetadata = transcriptDoc.piiMaskingMetadata || {};
          transcriptDoc.piiMaskingMetadata = {
            ...existingMetadata,
            awsPiiRedaction: true,
            totalEntitiesMasked:
              (existingMetadata.totalEntitiesMasked || 0) + piiCount,
            processedAt: new Date().toISOString(),
            redactionMethod: "AWS_TRANSCRIBE_STREAMING",
          };
        }

        transcriptDoc.segments.push(segment);
      }

      await transcriptDoc.save();
    } catch (err) {
      console.error(`[${sessionId}] Failed to persist live transcript:`, err);
    }
  }

  /**
   * Post-process speaker transitions to fix weak diarization
   * Merges speaker changes that occur within 2 seconds
   */
  postProcessSpeakerTransitions(sessionId, session) {
    try {
      if (session.speakerSegments.length < 2) return;

      const segments = session.speakerSegments;
      const mergedSegments = [segments[0]];

      for (let i = 1; i < segments.length; i++) {
        const current = segments[i];
        const previous = mergedSegments[mergedSegments.length - 1];

        // If speaker changed within 2 seconds AND confidence is low, likely false positive
        const timeDiff = current.time - previous.time;
        const isWeakTransition =
          timeDiff < 2000 &&
          (current.confidence < 0.7 || previous.confidence < 0.7);

        if (isWeakTransition && previous.speaker !== current.speaker) {
          console.log(
            `[${sessionId}] Filtering weak speaker transition: ${previous.speaker} -> ${current.speaker} (${timeDiff}ms, conf: ${(current.confidence * 100).toFixed(0)}%)`,
          );
          // Don't add this as a new segment - keep the previous speaker
        } else {
          mergedSegments.push(current);
        }
      }

      // Log speaker statistics
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

  /**
   * Check if session is active
   */
  isSessionActive(sessionId) {
    const session = this.sessions.get(sessionId);
    return session && session.isActive;
  }

  /**
   * Get active session count
   */
  getActiveSessionCount() {
    let count = 0;
    for (const [, session] of this.sessions) {
      if (session.isActive) count++;
    }
    return count;
  }

  /**
   * Clean up all sessions
   */
  cleanup() {
    console.log("Cleaning up all transcription sessions...");
    for (const [sessionId] of this.sessions) {
      this.stopTranscription(sessionId);
    }
  }
}

module.exports = new TranscriptionService();
