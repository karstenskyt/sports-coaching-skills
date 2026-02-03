/**
 * Transcript handling module
 * Provides detection, parsing, and session plan derivation from transcripts
 * Supports JSON, SRT, and VTT subtitle formats
 */

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    score?: number;
  }>;
}

export interface Transcript {
  language?: string;
  segments: TranscriptSegment[];
  format: "json" | "srt" | "vtt";
}

export interface DerivedSessionPlan {
  overview: string;
  activities: Array<{
    name: string;
    timeRange: string;
    duration: string;
    description: string;
    coachingQuotes: string[];
    keyPoints: string[];
  }>;
  coachingLanguage: {
    feedbackExamples: string[];
    questioningExamples: string[];
    instructionExamples: string[];
  };
}

/**
 * Detected transcript format
 */
export type TranscriptFormat = "json" | "srt" | "vtt" | "none";

/**
 * Detects the format of a transcript input
 */
export function detectTranscriptFormat(input: string): TranscriptFormat {
  const trimmed = input.trim();

  // Check for JSON format (segments array)
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray(parsed.segments) &&
      parsed.segments.length > 0 &&
      parsed.segments[0].text !== undefined &&
      parsed.segments[0].start !== undefined
    ) {
      return "json";
    }
    // Also support JSON array format [{start, end, text}, ...]
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed[0].text !== undefined &&
      parsed[0].start !== undefined
    ) {
      return "json";
    }
  } catch {
    // Not JSON, continue checking other formats
  }

  // Check for VTT format (starts with WEBVTT)
  if (trimmed.startsWith("WEBVTT")) {
    return "vtt";
  }

  // Check for SRT format (starts with a number, then timestamp line)
  // SRT format: "1\n00:00:00,000 --> 00:00:02,000\nText"
  const srtPattern = /^\d+\s*\n\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}/;
  if (srtPattern.test(trimmed)) {
    return "srt";
  }

  return "none";
}

/**
 * Detects if the input is any supported transcript format (JSON, SRT, VTT)
 */
export function isTranscript(input: string): boolean {
  return detectTranscriptFormat(input) !== "none";
}

/**
 * Parses SRT timestamp to seconds
 * Format: 00:00:00,000 or 00:00:00.000
 */
function parseSrtTimestamp(timestamp: string): number {
  const match = timestamp.match(/(\d{2}):(\d{2}):(\d{2})[,\.](\d{3})/);
  if (!match) return 0;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const milliseconds = parseInt(match[4], 10);

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

/**
 * Parses VTT timestamp to seconds
 * Format: 00:00:00.000 or 00:00.000
 */
function parseVttTimestamp(timestamp: string): number {
  // Handle both HH:MM:SS.mmm and MM:SS.mmm formats
  const longMatch = timestamp.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
  if (longMatch) {
    const hours = parseInt(longMatch[1], 10);
    const minutes = parseInt(longMatch[2], 10);
    const seconds = parseInt(longMatch[3], 10);
    const milliseconds = parseInt(longMatch[4], 10);
    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  }

  const shortMatch = timestamp.match(/(\d{2}):(\d{2})\.(\d{3})/);
  if (shortMatch) {
    const minutes = parseInt(shortMatch[1], 10);
    const seconds = parseInt(shortMatch[2], 10);
    const milliseconds = parseInt(shortMatch[3], 10);
    return minutes * 60 + seconds + milliseconds / 1000;
  }

  return 0;
}

/**
 * Parses SRT subtitle format into transcript segments
 */
function parseSrt(input: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const blocks = input.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;

    // Line 0: sequence number (ignored)
    // Line 1: timestamps
    // Lines 2+: text
    const timestampLine = lines[1];
    const timestampMatch = timestampLine.match(
      /(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/
    );

    if (!timestampMatch) continue;

    const start = parseSrtTimestamp(timestampMatch[1]);
    const end = parseSrtTimestamp(timestampMatch[2]);
    const text = lines.slice(2).join(" ").trim();

    if (text) {
      segments.push({ start, end, text });
    }
  }

  return segments;
}

/**
 * Parses VTT (WebVTT) subtitle format into transcript segments
 */
function parseVtt(input: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const lines = input.split("\n");

  let i = 0;

  // Skip WEBVTT header and any metadata
  while (i < lines.length && !lines[i].includes("-->")) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    // Look for timestamp line
    const timestampMatch = line.match(
      /(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})/
    );

    if (timestampMatch) {
      const start = parseVttTimestamp(timestampMatch[1]);
      const end = parseVttTimestamp(timestampMatch[2]);

      // Collect text lines until empty line or next timestamp
      const textLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() && !lines[i].includes("-->")) {
        // Skip cue identifiers (lines that are just numbers or identifiers)
        const trimmedLine = lines[i].trim();
        if (trimmedLine && !/^\d+$/.test(trimmedLine)) {
          // Remove VTT formatting tags like <v Speaker> or <c>
          const cleanText = trimmedLine
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .trim();
          if (cleanText) {
            textLines.push(cleanText);
          }
        }
        i++;
      }

      const text = textLines.join(" ").trim();
      if (text) {
        segments.push({ start, end, text });
      }
    } else {
      i++;
    }
  }

  return segments;
}

/**
 * Parses JSON transcript format into segments
 * Supports both {segments: [...]} and direct array [...] formats
 */
function parseJsonTranscript(input: string): { segments: TranscriptSegment[]; language?: string } {
  const parsed = JSON.parse(input);

  // Format: {language: "en", segments: [{start, end, text}, ...]}
  if (parsed.segments && Array.isArray(parsed.segments)) {
    return {
      language: parsed.language,
      segments: parsed.segments.map((s: any) => ({
        start: s.start,
        end: s.end,
        text: s.text,
        words: s.words,
      })),
    };
  }

  // Format: [{start, end, text}, ...]
  if (Array.isArray(parsed)) {
    return {
      segments: parsed.map((s: any) => ({
        start: s.start,
        end: s.end,
        text: s.text,
        words: s.words,
      })),
    };
  }

  throw new Error("Invalid JSON transcript format");
}

/**
 * Parses any supported transcript format into structured format
 */
export function parseTranscript(input: string): Transcript {
  const format = detectTranscriptFormat(input);

  switch (format) {
    case "json": {
      const { segments, language } = parseJsonTranscript(input);
      return { segments, language, format: "json" };
    }
    case "srt": {
      const segments = parseSrt(input);
      return { segments, format: "srt" };
    }
    case "vtt": {
      const segments = parseVtt(input);
      return { segments, format: "vtt" };
    }
    default:
      throw new Error("Input is not a recognized transcript format (JSON, SRT, or VTT)");
  }
}

/**
 * Extracts full text from transcript
 */
export function extractTranscriptText(transcript: Transcript): string {
  return transcript.segments.map((s) => s.text).join(" ");
}

/**
 * Formats time in seconds to MM:SS format
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Identifies activity boundaries based on time gaps and content patterns
 */
function identifyActivityBoundaries(
  segments: TranscriptSegment[]
): number[] {
  const boundaries: number[] = [0];
  const activityKeywords = [
    /all right/i,
    /let's start/i,
    /let's go/i,
    /next/i,
    /now we're going/i,
    /switch/i,
    /rotate/i,
    /okay.*everyone/i,
    /gather up/i,
    /come in/i,
    /bring it in/i,
  ];

  for (let i = 1; i < segments.length; i++) {
    const gap = segments[i].start - segments[i - 1].end;
    const text = segments[i].text;

    // Significant gap (>10 seconds) or activity keyword
    const hasGap = gap > 10;
    const hasKeyword = activityKeywords.some((kw) => kw.test(text));

    if (hasGap || hasKeyword) {
      // Avoid boundaries too close together (< 2 minutes)
      const lastBoundary = boundaries[boundaries.length - 1];
      if (i - lastBoundary > 10) {
        boundaries.push(i);
      }
    }
  }

  return boundaries;
}

/**
 * Extracts coaching language patterns from text
 */
function extractCoachingPatterns(text: string): {
  feedback: string[];
  questions: string[];
  instructions: string[];
} {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  const feedback: string[] = [];
  const questions: string[] = [];
  const instructions: string[] = [];

  const feedbackPatterns = [
    /good/i,
    /nice/i,
    /great/i,
    /perfect/i,
    /well done/i,
    /that's it/i,
    /better/i,
    /exactly/i,
    /yes/i,
    /there you go/i,
    /not quite/i,
    /try again/i,
    /watch/i,
  ];

  const instructionPatterns = [
    /make sure/i,
    /remember/i,
    /keep/i,
    /stay/i,
    /get/i,
    /move/i,
    /position/i,
    /set/i,
    /ready/i,
    /hands/i,
    /feet/i,
    /body/i,
  ];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length < 10 || trimmed.length > 200) continue;

    if (trimmed.includes("?")) {
      questions.push(trimmed);
    } else if (feedbackPatterns.some((p) => p.test(trimmed))) {
      feedback.push(trimmed);
    } else if (instructionPatterns.some((p) => p.test(trimmed))) {
      instructions.push(trimmed);
    }
  }

  return {
    feedback: feedback.slice(0, 15),
    questions: questions.slice(0, 10),
    instructions: instructions.slice(0, 15),
  };
}

/**
 * Derives a structured session plan from a transcript
 * Preserves verbatim coaching language for validation
 */
export function deriveSessionPlan(transcript: Transcript): DerivedSessionPlan {
  const segments = transcript.segments;
  const boundaries = identifyActivityBoundaries(segments);
  const activities: DerivedSessionPlan["activities"] = [];

  // Process each activity segment
  for (let i = 0; i < boundaries.length; i++) {
    const startIdx = boundaries[i];
    const endIdx =
      i < boundaries.length - 1 ? boundaries[i + 1] : segments.length;
    const activitySegments = segments.slice(startIdx, endIdx);

    if (activitySegments.length === 0) continue;

    const startTime = activitySegments[0].start;
    const endTime = activitySegments[activitySegments.length - 1].end;
    const activityText = activitySegments.map((s) => s.text).join(" ");

    // Extract key quotes (first instruction, feedback examples)
    const patterns = extractCoachingPatterns(activityText);
    const quotes = [
      ...patterns.instructions.slice(0, 3),
      ...patterns.feedback.slice(0, 2),
    ];

    // Determine activity name from context
    let activityName = `Activity ${i + 1}`;
    const namePatterns: Array<[RegExp, string]> = [
      [/warm.?up/i, "Warm-up"],
      [/stretch/i, "Stretching"],
      [/diving/i, "Diving Drill"],
      [/shot.?stop/i, "Shot Stopping"],
      [/distribution/i, "Distribution Practice"],
      [/cross/i, "Crossing Practice"],
      [/1v1|one.?v.?one/i, "1v1 Situations"],
      [/footwork/i, "Footwork Drill"],
      [/handling/i, "Handling Drill"],
      [/reaction/i, "Reaction Drill"],
      [/positioning/i, "Positioning Work"],
      [/set piece/i, "Set Piece Practice"],
      [/cool.?down/i, "Cool Down"],
      [/debrief|wrap/i, "Debrief"],
    ];

    for (const [pattern, name] of namePatterns) {
      if (pattern.test(activityText)) {
        activityName = name;
        break;
      }
    }

    // Extract key coaching points
    const keyPoints: string[] = [];
    const pointPatterns = [
      /remember[^.!?]*/i,
      /make sure[^.!?]*/i,
      /focus on[^.!?]*/i,
      /key is[^.!?]*/i,
      /important[^.!?]*/i,
    ];

    for (const pattern of pointPatterns) {
      const match = activityText.match(pattern);
      if (match && match[0].length > 15 && match[0].length < 150) {
        keyPoints.push(match[0].trim());
      }
    }

    activities.push({
      name: activityName,
      timeRange: `${formatTime(startTime)} - ${formatTime(endTime)}`,
      duration: `${Math.round((endTime - startTime) / 60)} min`,
      description: activityText.substring(0, 300) + (activityText.length > 300 ? "..." : ""),
      coachingQuotes: quotes,
      keyPoints: keyPoints.slice(0, 5),
    });
  }

  // Extract overall coaching language patterns
  const fullText = extractTranscriptText(transcript);
  const coachingPatterns = extractCoachingPatterns(fullText);

  // Build overview
  const totalDuration =
    segments.length > 0
      ? Math.round((segments[segments.length - 1].end - segments[0].start) / 60)
      : 0;

  const overview = `Session Duration: ${totalDuration} minutes
Activities: ${activities.length}
Focus Areas: ${activities
    .map((a) => a.name)
    .filter((n, i, arr) => arr.indexOf(n) === i)
    .join(", ")}`;

  return {
    overview,
    activities,
    coachingLanguage: {
      feedbackExamples: coachingPatterns.feedback,
      questioningExamples: coachingPatterns.questions,
      instructionExamples: coachingPatterns.instructions,
    },
  };
}

/**
 * Converts derived session plan to text format for validation
 */
export function sessionPlanToText(plan: DerivedSessionPlan): string {
  const lines: string[] = [];

  lines.push("SESSION OVERVIEW");
  lines.push(plan.overview);
  lines.push("");

  lines.push("ACTIVITIES");
  lines.push("");

  for (const activity of plan.activities) {
    lines.push(`### ${activity.name} (${activity.timeRange}, ${activity.duration})`);
    lines.push("");
    lines.push(activity.description);
    lines.push("");

    if (activity.coachingQuotes.length > 0) {
      lines.push("Coaching Language:");
      for (const quote of activity.coachingQuotes) {
        lines.push(`  - "${quote}"`);
      }
      lines.push("");
    }

    if (activity.keyPoints.length > 0) {
      lines.push("Key Points:");
      for (const point of activity.keyPoints) {
        lines.push(`  - ${point}`);
      }
      lines.push("");
    }
  }

  lines.push("COACHING LANGUAGE PATTERNS");
  lines.push("");

  if (plan.coachingLanguage.feedbackExamples.length > 0) {
    lines.push("Feedback Examples:");
    for (const ex of plan.coachingLanguage.feedbackExamples) {
      lines.push(`  - "${ex}"`);
    }
    lines.push("");
  }

  if (plan.coachingLanguage.questioningExamples.length > 0) {
    lines.push("Questions Used:");
    for (const ex of plan.coachingLanguage.questioningExamples) {
      lines.push(`  - "${ex}"`);
    }
    lines.push("");
  }

  if (plan.coachingLanguage.instructionExamples.length > 0) {
    lines.push("Instructions:");
    for (const ex of plan.coachingLanguage.instructionExamples) {
      lines.push(`  - "${ex}"`);
    }
  }

  return lines.join("\n");
}

/**
 * Principle evaluation type - determines which input to use
 */
export type EvaluationType = "transcript" | "plan" | "both";

/**
 * Keywords that suggest a principle should be evaluated against raw transcript
 * (coaching language, verbal feedback, questioning style)
 */
const TRANSCRIPT_KEYWORDS = [
  "feedback",
  "praise",
  "questioning",
  "question",
  "verbal",
  "communication",
  "language",
  "instruction",
  "cue",
  "prompt",
  "wait time",
  "check for understanding",
  "coaching point",
  "intervention",
];

/**
 * Keywords that suggest a principle should be evaluated against session plan
 * (activity design, spatial layout, constraint manipulation)
 */
const PLAN_KEYWORDS = [
  "design",
  "constraint",
  "task",
  "activity",
  "progression",
  "spatial",
  "area",
  "layout",
  "structure",
  "organization",
  "representative",
  "variability",
  "affordance",
  "environment",
  "setup",
  "equipment",
  "grid",
  "zone",
];

/**
 * Determines evaluation type based on principle name and description content.
 * Uses keyword matching to route principles to the appropriate input:
 * - "transcript": coaching language, feedback, questioning principles
 * - "plan": activity design, spatial, constraint principles
 * - "both": general principles or unclear categorization
 *
 * This function uses content-based heuristics rather than skill-specific logic,
 * making it work with any loaded skill definition.
 */
export function getEvaluationType(
  _skillPrefix: string,
  principleName: string,
  principleDescription?: string
): EvaluationType {
  const searchText = `${principleName} ${principleDescription || ""}`.toLowerCase();

  // Check for transcript-focused keywords
  const hasTranscriptKeywords = TRANSCRIPT_KEYWORDS.some((kw) =>
    searchText.includes(kw.toLowerCase())
  );

  // Check for plan-focused keywords
  const hasPlanKeywords = PLAN_KEYWORDS.some((kw) =>
    searchText.includes(kw.toLowerCase())
  );

  // Route based on keyword presence
  if (hasTranscriptKeywords && !hasPlanKeywords) {
    return "transcript";
  }

  if (hasPlanKeywords && !hasTranscriptKeywords) {
    return "plan";
  }

  // Mixed or no clear signals: evaluate against both
  return "both";
}
