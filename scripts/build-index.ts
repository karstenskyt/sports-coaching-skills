import fs from "fs";
import path from "path";
import { LocalIndex } from "vectra";

// pdf-parse types
const pdfParse = require("pdf-parse");

// --- CLI args ---

function parseArgs(): { skill: string } {
  const args = process.argv.slice(2);
  const skillIdx = args.indexOf("--skill");
  if (skillIdx === -1 || skillIdx + 1 >= args.length) {
    console.error("Usage: npm run build-index -- --skill <skill-name>");
    console.error("Example: npm run build-index -- --skill goalkeeping-coach");
    process.exit(1);
  }
  return { skill: args[skillIdx + 1] };
}

// --- Embedding ---

async function getEmbedder() {
  const { pipeline } = await import("@xenova/transformers");
  return pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
}

// --- Chunking ---

interface Chunk {
  text: string;
  chapter: string;
  page: number;
  source: string;
}

function chunkText(
  fullText: string,
  pageTexts: string[],
  source: string,
  chunkSize = 500,
  overlap = 50
): Chunk[] {
  const chunks: Chunk[] = [];
  const words = fullText.split(/\s+/);

  let currentChapter = "Introduction";
  const chapterPattern = /^(Chapter\s+\d+|CHAPTER\s+\d+|Part\s+\d+|PART\s+\d+)[:\s]*(.*)/;

  // Build page map
  let cumWords = 0;
  const pageWordBoundaries: number[] = [];
  for (const pt of pageTexts) {
    cumWords += pt.split(/\s+/).length;
    pageWordBoundaries.push(cumWords);
  }

  function getPageForWordIndex(wordIdx: number): number {
    for (let i = 0; i < pageWordBoundaries.length; i++) {
      if (wordIdx < pageWordBoundaries[i]) return i + 1;
    }
    return pageWordBoundaries.length;
  }

  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const slice = words.slice(i, i + chunkSize);
    const text = slice.join(" ");

    const match = text.match(chapterPattern);
    if (match) {
      currentChapter = match[0].substring(0, 80);
    }

    if (text.trim().length < 50) continue;

    chunks.push({
      text,
      chapter: currentChapter,
      page: getPageForWordIndex(i),
      source,
    });
  }

  return chunks;
}

// --- Transcript ingestion (SRT, VTT, JSON/.segments) ---

interface Segment {
  start: number;
  end: number;
  text: string;
}

const TRANSCRIPT_EXTENSIONS = [".srt", ".vtt", ".json", ".segments"];
const TEXT_EXTENSIONS = [".txt", ".md"];
const RTF_EXTENSIONS = [".rtf"];

function isTranscriptFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return TRANSCRIPT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isTextFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isRtfFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return RTF_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function stripRtf(rtfContent: string): string {
  // RTF to plain text converter with binary data filtering
  let text = rtfContent;

  // FIRST: Remove embedded binary/hex data blocks (themedata, datastore, blipuid, etc.)
  // These contain long hexadecimal strings that bloat the output
  text = text.replace(/\{\\\*\\(themedata|datastore|colorschememapping|blipuid|panose)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gi, "");

  // Remove picture/object data (contains hex image data)
  text = text.replace(/\{\\pict[^{}]*(?:\{[^{}]*\}[^{}]*)*[0-9a-f\s]{100,}\}/gi, "");

  // Remove any remaining long hex sequences (>50 consecutive hex chars)
  text = text.replace(/[0-9a-f]{50,}/gi, "");

  // Remove RTF header sections
  text = text
    .replace(/\{\\\*\\[a-z]+[^{}]*\}/gi, "")
    .replace(/\\fonttbl[^}]*\}/gi, "")
    .replace(/\\colortbl[^}]*\}/gi, "")
    .replace(/\\stylesheet[^}]*\}/gi, "")
    .replace(/\\latentstyles[^}]*\}/gi, "")
    .replace(/\\pgptbl[^}]*\}/gi, "")
    .replace(/\\rsidtbl[^}]*\}/gi, "");

  // Replace common RTF escape sequences
  text = text
    .replace(/\\par\b/gi, "\n")
    .replace(/\\line\b/gi, "\n")
    .replace(/\\tab\b/gi, "\t")
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\rquote\b/g, "'")
    .replace(/\\lquote\b/g, "'")
    .replace(/\\rdblquote\b/g, '"')
    .replace(/\\ldblquote\b/g, '"')
    .replace(/\\emdash\b/g, "—")
    .replace(/\\endash\b/g, "–")
    .replace(/\\bullet\b/g, "•")
    .replace(/\\~\b/g, " ")
    .replace(/\\_\b/g, "-");

  // Remove RTF control words (backslash followed by letters and optional number)
  text = text.replace(/\\[a-z]+(-?\d+)?\s?/gi, "");

  // Remove remaining braces and clean up
  text = text
    .replace(/[{}]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Final cleanup: remove lines that are mostly non-text characters
  const lines = text.split("\n");
  const cleanLines = lines.filter((line) => {
    if (line.length < 3) return true; // Keep short lines
    const alphaCount = (line.match(/[a-zA-Z]/g) || []).length;
    return alphaCount / line.length > 0.3; // Keep lines with >30% letters
  });

  return cleanLines.join("\n").trim();
}

function parseSrtTimestamp(ts: string): number {
  // 00:01:23,456 → seconds
  const [h, m, rest] = ts.split(":");
  const [s, ms] = rest.split(",");
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
}

function parseSrt(raw: string): Segment[] {
  const segments: Segment[] = [];
  const blocks = raw.trim().split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;
    const timeLine = lines[1];
    const match = timeLine.match(
      /(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/
    );
    if (!match) continue;
    const start = parseSrtTimestamp(match[1].replace(".", ","));
    const end = parseSrtTimestamp(match[2].replace(".", ","));
    const text = lines.slice(2).join(" ").replace(/<[^>]*>/g, "").trim();
    if (text) segments.push({ start, end, text });
  }
  return segments;
}

function parseVtt(raw: string): Segment[] {
  // Strip WEBVTT header and optional metadata lines
  const body = raw.replace(/^WEBVTT[^\n]*\n/, "").replace(/^NOTE[^\n]*\n(\n|[^\n])*?\n\n/gm, "");
  return parseSrt(body);
}

function parseJsonSegments(raw: string): Segment[] {
  const data = JSON.parse(raw);
  // Support both flat arrays and {segments: [...]} wrapper objects
  const arr = Array.isArray(data) ? data : Array.isArray(data.segments) ? data.segments : null;
  if (!arr) throw new Error("Expected JSON array or object with 'segments' array");
  return arr.map((s: any) => ({
    start: Number(s.start) || 0,
    end: Number(s.end) || 0,
    text: String(s.text || ""),
  }));
}

function chunkTranscript(
  segments: Segment[],
  source: string,
  chunkSize = 500,
  overlap = 50
): Chunk[] {
  // Join all segment texts into continuous text
  const fullText = segments.map((s) => s.text.trim()).join(" ");
  const words = fullText.split(/\s+/);
  const chunks: Chunk[] = [];

  // Build a time map: for each word index, find the approximate segment index
  let wordIdx = 0;
  const wordToSegment: number[] = [];
  for (let si = 0; si < segments.length; si++) {
    const segWords = segments[si].text.trim().split(/\s+/);
    for (const _ of segWords) {
      wordToSegment.push(si);
      wordIdx++;
    }
  }

  function getTimestamp(wi: number): string {
    const segIdx = Math.min(wi, wordToSegment.length - 1);
    const seg = segments[wordToSegment[segIdx] || 0];
    if (!seg) return "0:00";
    const totalSec = Math.floor(seg.start);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  }

  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const slice = words.slice(i, i + chunkSize);
    const text = slice.join(" ");

    if (text.trim().length < 50) continue;

    chunks.push({
      text,
      chapter: `Transcript @ ${getTimestamp(i)}`,
      page: Math.floor(i / chunkSize) + 1, // pseudo-page for ordering
      source,
    });
  }

  return chunks;
}

// --- RTF ingestion ---

function ingestRtfFile(filePath: string): Chunk[] {
  const fileName = path.basename(filePath);
  console.log(`  Reading RTF: ${fileName}`);

  const raw = fs.readFileSync(filePath, "utf-8");
  const plainText = stripRtf(raw);
  console.log(`    ${plainText.length} characters (extracted)`);

  // Chunk the text similarly to other text files
  const chunks: Chunk[] = [];
  const words = plainText.split(/\s+/).filter((w) => w.length > 0);
  const chunkSize = 500;
  const overlap = 50;

  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const slice = words.slice(i, i + chunkSize);
    const text = slice.join(" ");

    if (text.trim().length < 50) continue;

    chunks.push({
      text,
      chapter: fileName.replace(/\.rtf$/i, ""),
      page: Math.floor(i / chunkSize) + 1,
      source: fileName,
    });
  }

  return chunks;
}

// --- Plain text ingestion ---

function ingestTextFile(filePath: string): Chunk[] {
  const fileName = path.basename(filePath);
  console.log(`  Reading text file: ${fileName}`);

  const raw = fs.readFileSync(filePath, "utf-8");
  console.log(`    ${raw.length} characters`);

  // Chunk the text file similarly to PDFs but without page tracking
  const chunks: Chunk[] = [];
  const words = raw.split(/\s+/);
  const chunkSize = 500;
  const overlap = 50;

  let currentSection = "Document";
  const sectionPattern = /^(#+\s+.*|[A-Z][A-Za-z\s]+\n[-=]+)/m;

  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const slice = words.slice(i, i + chunkSize);
    const text = slice.join(" ");

    if (text.trim().length < 50) continue;

    // Try to detect section headers
    const match = text.match(sectionPattern);
    if (match) {
      currentSection = match[0].substring(0, 80).replace(/[-=\n]/g, "").trim();
    }

    chunks.push({
      text,
      chapter: currentSection,
      page: Math.floor(i / chunkSize) + 1,
      source: fileName,
    });
  }

  return chunks;
}

// --- PDF ingestion ---

async function ingestPdf(filePath: string): Promise<Chunk[]> {
  const fileName = path.basename(filePath);
  console.log(`  Reading PDF: ${fileName}`);

  const pdfBuffer = fs.readFileSync(filePath);

  // Single-pass parse: collect page texts via pagerender callback
  // and get full text in one call (avoids double-parsing large PDFs)
  const pageTexts: string[] = [];
  const pdfData = await pdfParse(pdfBuffer, {
    // For very large PDFs, set max pages to 0 (unlimited)
    max: 0,
    pagerender: (pageData: any) => {
      return pageData.getTextContent().then((textContent: any) => {
        const pageText = textContent.items.map((item: any) => item.str).join(" ");
        pageTexts.push(pageText);
        return pageText;
      });
    },
  });

  console.log(`    ${pdfData.numpages} pages, ${pdfData.text.length} characters`);

  return chunkText(pdfData.text, pageTexts, fileName);
}

// --- Transcript file ingestion ---

function ingestTranscript(filePath: string): Chunk[] {
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  console.log(`  Reading transcript: ${fileName}`);

  const raw = fs.readFileSync(filePath, "utf-8");
  let segments: Segment[];

  if (ext === ".srt") {
    segments = parseSrt(raw);
  } else if (ext === ".vtt") {
    segments = parseVtt(raw);
  } else {
    // .json or .segments — JSON array format
    segments = parseJsonSegments(raw);
  }

  console.log(`    ${segments.length} segments`);

  return chunkTranscript(segments, fileName);
}

// --- Main ---

async function main() {
  const { skill } = parseArgs();
  const resourcesDir = path.resolve(process.cwd(), "resources", skill);
  const indexPath = path.resolve(process.cwd(), "data", skill);

  if (!fs.existsSync(resourcesDir)) {
    console.error(`Resources directory not found: ${resourcesDir}`);
    console.error(`Create it and add PDF/transcript files, then re-run.`);
    process.exit(1);
  }

  const files = fs.readdirSync(resourcesDir);
  const pdfFiles = files.filter((f) => f.toLowerCase().endsWith(".pdf"));
  const transcriptFiles = files.filter((f) => isTranscriptFile(f));
  const textFiles = files.filter((f) => isTextFile(f));
  const rtfFiles = files.filter((f) => isRtfFile(f));

  if (pdfFiles.length === 0 && transcriptFiles.length === 0 && textFiles.length === 0 && rtfFiles.length === 0) {
    console.error(`No supported files found in ${resourcesDir}`);
    console.error(`Supported: .pdf, .srt, .vtt, .json, .segments, .txt, .md, .rtf`);
    process.exit(1);
  }

  console.log(`\nBuilding index for skill: ${skill}`);
  const fileTypes: string[] = [];
  if (pdfFiles.length > 0) fileTypes.push(`${pdfFiles.length} PDFs`);
  if (transcriptFiles.length > 0) fileTypes.push(`${transcriptFiles.length} transcripts`);
  if (textFiles.length > 0) fileTypes.push(`${textFiles.length} text files`);
  if (rtfFiles.length > 0) fileTypes.push(`${rtfFiles.length} RTF files`);
  console.log(`Resources: ${fileTypes.join(", ")}`);

  // Ingest all files
  let allChunks: Chunk[] = [];

  for (const pf of pdfFiles) {
    const chunks = await ingestPdf(path.join(resourcesDir, pf));
    allChunks.push(...chunks);
  }

  for (const tf of transcriptFiles) {
    const chunks = ingestTranscript(path.join(resourcesDir, tf));
    allChunks.push(...chunks);
  }

  for (const txtf of textFiles) {
    const chunks = ingestTextFile(path.join(resourcesDir, txtf));
    allChunks.push(...chunks);
  }

  for (const rtff of rtfFiles) {
    const chunks = ingestRtfFile(path.join(resourcesDir, rtff));
    allChunks.push(...chunks);
  }

  console.log(`\nTotal chunks: ${allChunks.length}`);

  // Embed and index
  console.log("Loading embedding model (first run downloads ~90MB)...");
  const embedder = await getEmbedder();

  // Create vectra index
  fs.mkdirSync(indexPath, { recursive: true });
  const index = new LocalIndex(indexPath);
  if (await index.isIndexCreated()) {
    fs.rmSync(indexPath, { recursive: true, force: true });
    fs.mkdirSync(indexPath, { recursive: true });
  }
  await index.createIndex();

  // Process in batches to handle large document sets without overwhelming memory
  const BATCH_SIZE = 20;
  console.log(`Embedding and indexing chunks (batch size: ${BATCH_SIZE})...`);

  for (let batchStart = 0; batchStart < allChunks.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, allChunks.length);
    const batch = allChunks.slice(batchStart, batchEnd);

    // Embed entire batch at once
    const texts = batch.map((c) => c.text);
    const results = await embedder(texts, {
      pooling: "mean",
      normalize: true,
    });

    // results.data is a flat Float32Array: batchSize * 384
    const dim = 384;
    for (let j = 0; j < batch.length; j++) {
      const vector = Array.from(
        (results.data as Float32Array).slice(j * dim, (j + 1) * dim)
      );

      await index.insertItem({
        vector,
        metadata: {
          text: batch[j].text,
          chapter: batch[j].chapter,
          page: batch[j].page,
          source: batch[j].source,
        },
      });
    }

    console.log(`  ${batchEnd}/${allChunks.length} chunks indexed`);
  }

  console.log(`\nDone! Index written to ${indexPath}`);
  const totalFiles = pdfFiles.length + transcriptFiles.length + textFiles.length + rtfFiles.length;
  console.log(`${allChunks.length} chunks from ${totalFiles} files`);
  console.log(`\nNext: ensure skills/${skill}.json exists, then rebuild the MCP server with 'npm run build'`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
