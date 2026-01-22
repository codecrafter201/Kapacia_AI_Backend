"use strict";

const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const { TextDecoder } = require("util");
const { jsonrepair } = require("jsonrepair");

class BedrockService {
  constructor() {
    const region = process.env.AWS_REGION || "us-east-1";

    const credentials =
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined;

    this.modelId =
      process.env.AWS_BEDROCK_MODEL_ID || "anthropic.claude-sonnet-4-20250514";

    this.client = new BedrockRuntimeClient({
      region,
      ...(credentials ? { credentials } : {}),
    });

    this.decoder = new TextDecoder();
  }

  buildPrompt({ transcriptText, caseName, sessionDate, language, framework }) {
    const sessionDateStr = sessionDate
      ? new Date(sessionDate).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "";

    return `You are an experienced clinician. Generate a ${framework || "SOAP"} note from this therapy session.

Patient/Case: ${caseName || "Unknown"}
Session Date: ${sessionDateStr}
Language: ${language || "english"}

CRITICAL JSON FORMATTING RULES:
1. Return ONLY a valid JSON object - no markdown, no code blocks, no extra text
2. Use these exact four keys: subjective, objective, assessment, plan
3. All values must be valid JSON strings (escape newlines as \\n, not actual line breaks)
4. For the plan field, use \\n to separate numbered items
5. If information is missing, use "Not specified"

Example:
{"subjective":"Patient reports symptoms","objective":"No observable findings","assessment":"Clinical impression","plan":"1. Treatment\\n2. Follow-up\\n3. Monitoring"}

Now process this transcript:
${transcriptText}

Return only the JSON object:
`.concat("\n\nTranscript:\n", transcriptText);
  }

  //   parseSoapContent(text) {
  //     const emptyResult = {
  //       subjective: "",
  //       objective: "",
  //       assessment: "",
  //       plan: "",
  //     };

  //     try {
  //       let parsed;
  //       let jsonText = text;

  //       // Sanitize control characters that break JSON parsing
  //       // Remove invalid control characters but keep valid ones like \n, \t
  //       const sanitizeJSON = (str) => {
  //         return str
  //           .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // Remove control chars except \n (\x0A), \r (\x0D), \t (\x09)
  //           .trim();
  //       };

  //       // Try direct JSON parsing first
  //       try {
  //         jsonText = sanitizeJSON(text);
  //         parsed = JSON.parse(jsonText);
  //       } catch (directErr) {
  //         // Fallback: try triple-backtick fenced JSON
  //         const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  //         if (fenced && fenced[1]) {
  //           jsonText = sanitizeJSON(fenced[1]);
  //           parsed = JSON.parse(jsonText);
  //         } else {
  //           // Last resort: try to extract any JSON object from the text
  //           const jsonMatch = text.match(/\{[\s\S]*\}/);
  //           if (jsonMatch) {
  //             jsonText = sanitizeJSON(jsonMatch[0]);
  //             parsed = JSON.parse(jsonText);
  //           } else {
  //             console.error("No valid JSON found in AI output");
  //             return { ...emptyResult, subjective: text.trim() };
  //           }
  //         }
  //       }

  //       const subjective = String(
  //         parsed.subjective || parsed.Subjective || parsed.S || "",
  //       ).trim();
  //       const objective = String(
  //         parsed.objective || parsed.Objective || parsed.O || "",
  //       ).trim();
  //       const assessment = String(
  //         parsed.assessment || parsed.Assessment || parsed.A || "",
  //       ).trim();
  //       const plan = String(parsed.plan || parsed.Plan || parsed.P || "").trim();

  //       // Validate that we got actual content, not just empty strings
  //       const hasValidContent = subjective || objective || assessment || plan;

  //       if (!hasValidContent) {
  //         console.warn(
  //           "AI returned empty SOAP fields, using raw text as fallback",
  //         );
  //         return { ...emptyResult, subjective: text.trim() };
  //       }

  //       return {
  //         subjective: subjective || "",
  //         objective: objective || "",
  //         assessment: assessment || "",
  //         plan: this.normalizePlan(plan),
  //       };
  //     } catch (err) {
  //       console.error(
  //         "Failed to parse SOAP content:",
  //         err.message,
  //         "Text preview:",
  //         text.substring(0, 300),
  //       );
  //       // If all parsing fails, return the whole text as subjective to avoid losing data
  //       return { ...emptyResult, subjective: text.trim() };
  //     }
  //   }

  parseSoapContent(text) {
    const emptyResult = {
      subjective: "",
      objective: "",
      assessment: "",
      plan: "",
    };

    try {
      let parsed;
      let cleanedText = text.trim();

      // Try direct JSON parsing first
      try {
        parsed = JSON.parse(cleanedText);
      } catch (directErr) {
        // Try to extract JSON from markdown
        const fenced = cleanedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        const jsonText = fenced
          ? fenced[1]
          : (cleanedText.match(/\{[\s\S]*\}/) || [])[0];

        if (jsonText) {
          try {
            // Try to repair the JSON
            const repairedJson = jsonrepair(jsonText);
            parsed = JSON.parse(repairedJson);
          } catch (repairErr) {
            console.error("JSON repair failed:", repairErr.message);
            return { ...emptyResult, subjective: text.trim() };
          }
        } else {
          console.error("No valid JSON found");
          return { ...emptyResult, subjective: text.trim() };
        }
      }

      // Rest of your logic...
      const subjective = String(parsed.subjective || "").trim();
      const objective = String(parsed.objective || "").trim();
      const assessment = String(parsed.assessment || "").trim();
      const plan = String(parsed.plan || "").trim();

      return {
        subjective,
        objective,
        assessment,
        plan: this.normalizePlan(plan),
      };
    } catch (err) {
      console.error("Failed to parse SOAP content:", err.message);
      return { ...emptyResult, subjective: text.trim() };
    }
  }

  normalizePlan(planValue) {
    if (!planValue) return "";
    if (Array.isArray(planValue)) return planValue.join("\n");
    if (typeof planValue === "string") return planValue;
    return JSON.stringify(planValue);
  }

  formatContentText(content) {
    const sections = [
      { label: "S (Subjective)", value: content.subjective },
      { label: "O (Objective)", value: content.objective },
      { label: "A (Assessment)", value: content.assessment },
      { label: "P (Plan)", value: content.plan },
    ];

    return sections
      .filter((section) => section.value)
      .map((section) => `${section.label}:\n${section.value}`)
      .join("\n\n");
  }

  async generateSoapNoteFromTranscript(options) {
    const {
      transcriptText,
      framework = "SOAP",
      temperature = 0.2,
      maxTokens = 1200,
      caseName,
      sessionDate,
      language = "english",
    } = options;

    if (!transcriptText) {
      throw new Error("Transcript text is required to generate a SOAP note");
    }

    const prompt = this.buildPrompt({
      transcriptText,
      caseName,
      sessionDate,
      language,
      framework,
    });

    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: maxTokens,
      temperature,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId: this.modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(payload),
    });

    const response = await this.client.send(command);
    const responseString = this.decoder.decode(response.body);

    let aiText = "";
    try {
      const parsed = JSON.parse(responseString);
      aiText = parsed?.content?.[0]?.text || parsed?.output_text || "";
    } catch (err) {
      throw new Error("Failed to parse Bedrock response: " + err.message);
    }

    if (!aiText) {
      throw new Error("Bedrock response did not include content");
    }

    const content = this.parseSoapContent(aiText);
    const contentText = this.formatContentText(content);

    return {
      content,
      contentText,
      modelId: this.modelId,
      rawText: aiText,
    };
  }

  buildTimelineSummaryPrompt({
    caseName,
    caseData,
    enrichedSessions,
    files,
    existingSummaries,
    periodStart,
    periodEnd,
  }) {
    const periodStartStr = new Date(periodStart).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const periodEndStr = new Date(periodEnd).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    // Build sessions summary
    let sessionsSummary = "";
    if (enrichedSessions && enrichedSessions.length > 0) {
      sessionsSummary = enrichedSessions
        .map((session, idx) => {
          let sessionText = `\nSession ${idx + 1} (${
            session.sessionDate
              ? new Date(session.sessionDate).toLocaleDateString("en-US")
              : "Date Unknown"
          }):`;

          if (session.soapNote?.content) {
            const soap = session.soapNote.content;
            sessionText += `\n- Subjective: ${
              soap.subjective?.substring(0, 200) || "N/A"
            }`;
            sessionText += `\n- Objective: ${
              soap.objective?.substring(0, 200) || "N/A"
            }`;
            sessionText += `\n- Assessment: ${
              soap.assessment?.substring(0, 150) || "N/A"
            }`;
            sessionText += `\n- Plan: ${soap.plan?.substring(0, 150) || "N/A"}`;
          } else if (session.transcript?.rawText) {
            sessionText += `\n- Transcript: ${session.transcript.rawText.substring(
              0,
              300,
            )}...`;
          }

          return sessionText;
        })
        .join("\n");
    }

    // Build files summary
    let filesSummary = "";
    if (files && files.length > 0) {
      filesSummary =
        "\n\nUploaded Clinical Records:\n" +
        files
          .map(
            (f) =>
              `- ${f.fileName} (${f.mimeType}, uploaded by ${
                f.uploadedBy?.name || "Unknown"
              })`,
          )
          .join("\n");
    }

    // Build previous summaries context
    let previousSummariesContext = "";
    if (existingSummaries && existingSummaries.length > 0) {
      previousSummariesContext =
        "\n\nPrevious Summary (for context and continuity):\n" +
        existingSummaries[0].summaryText?.substring(0, 500) +
        "...\n(Note: Build upon this if creating a new version)";
    }

    return `You are an experienced clinical supervisor creating a comprehensive timeline summary for a therapy case.

CASE: ${caseName || "Patient Case"}
PERIOD: ${periodStartStr} to ${periodEndStr}
TOTAL SESSIONS: ${enrichedSessions?.length || 0}
UPLOADED DOCUMENTS: ${files?.length || 0}

Create a detailed, professional clinical timeline summary with these sections:

1. **PATIENT OVERVIEW** - Brief introduction to the patient and presenting concerns

2. **BACKGROUND (FROM CLINICAL RECORDS)** - Synthesize uploaded documents and files:
${filesSummary || "No files uploaded"}

3. **TREATMENT COURSE SUMMARY** - Session-by-session progress:
${sessionsSummary || "No session data available"}

4. **CLINICAL THEMES & PATTERNS** - Key recurring themes:
   - Primary presenting issues and manifestations
   - Coping mechanisms observed
   - Interpersonal patterns

5. **KEY DECISIONS & ACTIONS** - Important clinical decisions and interventions made

6. **PROTECTIVE FACTORS** - Strengths and resources:
   - Insights and understanding
   - Social support
   - Coping skills developed
   - Environmental/occupational factors

7. **RISK FACTORS** - Areas of concern:
   - Symptom severity/trajectory
   - Environmental stressors
   - Treatment adherence issues
   - Protective factor deficits

8. **CLINICAL IMPRESSION & RECOMMENDATIONS** - Overall assessment and next steps

${previousSummariesContext || ""}

IMPORTANT:
- Use professional clinical language
- Be specific with clinical observations and progress
- Include measurable improvements where evident
- Highlight any treatment modifications
- Ensure continuity with previous summaries if updating
- Keep narrative clear and evidence-based
- Avoid speculation; note any areas where information is limited`;
  }

  async generateTimelineSummary(options) {
    const {
      caseName,
      caseData,
      enrichedSessions,
      files,
      existingSummaries,
      periodStart,
      periodEnd,
      temperature = 0.3,
      maxTokens = 2500,
    } = options;

    if (!enrichedSessions || enrichedSessions.length === 0) {
      throw new Error("No session data available to generate timeline summary");
    }

    const prompt = this.buildTimelineSummaryPrompt({
      caseName,
      caseData,
      enrichedSessions,
      files,
      existingSummaries,
      periodStart,
      periodEnd,
    });

    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: maxTokens,
      temperature,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId: this.modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(payload),
    });

    const response = await this.client.send(command);
    const responseString = this.decoder.decode(response.body);

    let aiText = "";
    try {
      const parsed = JSON.parse(responseString);
      aiText = parsed?.content?.[0]?.text || parsed?.output_text || "";
    } catch (err) {
      throw new Error("Failed to parse Bedrock response: " + err.message);
    }

    if (!aiText) {
      throw new Error("Bedrock response did not include content");
    }

    // Structure the summary content
    const summaryContent = {
      text: aiText,
      sections: {
        patientOverview: this.extractSection(aiText, "PATIENT OVERVIEW"),
        background: this.extractSection(aiText, "BACKGROUND"),
        treatmentCourse: this.extractSection(aiText, "TREATMENT COURSE"),
        clinicalThemes: this.extractSection(aiText, "CLINICAL THEMES"),
        keyDecisions: this.extractSection(aiText, "KEY DECISIONS"),
        protectiveFactors: this.extractSection(aiText, "PROTECTIVE FACTORS"),
        riskFactors: this.extractSection(aiText, "RISK FACTORS"),
        clinicalImpression: this.extractSection(aiText, "CLINICAL IMPRESSION"),
      },
    };

    return {
      summaryText: aiText,
      summaryContent,
      modelId: this.modelId,
    };
  }

  extractSection(text, sectionTitle) {
    const regex = new RegExp(
      `\\*\\*${sectionTitle}\\*\\*[\\s\\S]*?(?=\\*\\*|$)`,
      "i",
    );
    const match = text.match(regex);
    return match ? match[0].replace(`**${sectionTitle}**`, "").trim() : "";
  }
}

module.exports = new BedrockService();
