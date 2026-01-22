#!/usr/bin/env node

/**
 * AWS Transcribe Connection Diagnostic Script
 * Run this to test your AWS configuration and identify HTTP/2 stream issues
 */

require('dotenv').config();
const {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} = require("@aws-sdk/client-transcribe-streaming");
const { PassThrough } = require("stream");

async function testAWSConnection() {
  console.log("🔍 AWS Transcribe Connection Diagnostic");
  console.log("=====================================");

  // Check environment variables
  console.log("\n1. Checking Environment Variables:");
  console.log(`   AWS_ACCESS_KEY_ID: ${process.env.AWS_ACCESS_KEY_ID ? '✅ Set' : '❌ Missing'}`);
  console.log(`   AWS_SECRET_ACCESS_KEY: ${process.env.AWS_SECRET_ACCESS_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`   AWS_REGION: ${process.env.AWS_REGION || 'us-east-1 (default)'}`);

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error("\n❌ AWS credentials not configured!");
    console.log("Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in your .env file");
    process.exit(1);
  }

  // Create client
  const client = new TranscribeStreamingClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    requestHandler: {
      requestTimeout: 30000,
      connectionTimeout: 10000,
    },
  });

  console.log("\n2. Testing Basic Connection (no PII):");
  await testConfiguration(client, {
    name: "Basic",
    params: {
      LanguageCode: "en-US",
      MediaSampleRateHertz: 16000,
      MediaEncoding: "pcm",
      AudioStream: createTestAudioStream(),
    }
  });

  console.log("\n3. Testing with Speaker Labels:");
  await testConfiguration(client, {
    name: "Speaker Labels",
    params: {
      LanguageCode: "en-US",
      MediaSampleRateHertz: 16000,
      MediaEncoding: "pcm",
      ShowSpeakerLabel: true,
      MaxSpeakerLabels: 2,
      AudioStream: createTestAudioStream(),
    }
  });

  console.log("\n4. Testing with PII Redaction:");
  await testConfiguration(client, {
    name: "PII Redaction",
    params: {
      LanguageCode: "en-US",
      MediaSampleRateHertz: 16000,
      MediaEncoding: "pcm",
      ContentIdentificationType: "PII",
      PiiEntityTypes: [
        "NAME",
        "ADDRESS",
        "EMAIL",
        "PHONE",
        "SSN",
        "CREDIT_DEBIT_NUMBER",
        "BANK_ACCOUNT_NUMBER",
      ],
      AudioStream: createTestAudioStream(),
    }
  });

  console.log("\n5. Testing with PII + Speaker Labels:");
  await testConfiguration(client, {
    name: "PII + Speaker Labels",
    params: {
      LanguageCode: "en-US",
      MediaSampleRateHertz: 16000,
      MediaEncoding: "pcm",
      ShowSpeakerLabel: true,
      MaxSpeakerLabels: 2,
      ContentIdentificationType: "PII",
      PiiEntityTypes: [
        "NAME",
        "ADDRESS",
        "EMAIL",
        "PHONE",
        "SSN",
        "CREDIT_DEBIT_NUMBER",
        "BANK_ACCOUNT_NUMBER",
      ],
      AudioStream: createTestAudioStream(),
    }
  });

  console.log("\n✅ Diagnostic Complete!");
  console.log("\nRecommendations:");
  console.log("- If Basic connection fails: Check AWS credentials and network");
  console.log("- If PII tests fail: Use basic transcription without PII redaction");
  console.log("- If all tests fail: Check AWS service limits and account permissions");
}

async function testConfiguration(client, config) {
  try {
    console.log(`   Testing ${config.name}...`);
    
    const command = new StartStreamTranscriptionCommand(config.params);
    const response = await client.send(command);
    
    console.log(`   ✅ ${config.name}: Connection successful`);
    
    // Close the stream immediately
    if (response.TranscriptResultStream) {
      try {
        const stream = response.TranscriptResultStream;
        if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
          // Just start the iterator to establish connection, then break
          for await (const event of stream) {
            break; // Exit immediately after first event or connection
          }
        }
      } catch (streamError) {
        // Ignore stream errors for this test
        console.log(`   ⚠️  ${config.name}: Stream error (expected): ${streamError.message}`);
      }
    }
    
  } catch (error) {
    console.log(`   ❌ ${config.name}: ${error.message}`);
    
    if (error.message?.includes('HTTP/2')) {
      console.log(`      → HTTP/2 stream error detected`);
      console.log(`      → This configuration is not supported or has invalid parameters`);
    }
    
    if (error.$metadata?.requestId) {
      console.log(`      → Request ID: ${error.$metadata.requestId}`);
    }
  }
}

async function* createTestAudioStream() {
  // Create minimal test audio stream
  const testChunk = Buffer.alloc(1024, 0); // 1KB of silence
  yield { AudioEvent: { AudioChunk: testChunk } };
}

// Run the diagnostic
testAWSConnection().catch(error => {
  console.error("\n💥 Diagnostic failed:", error);
  process.exit(1);
});