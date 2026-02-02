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

// --- Transcript (.segments) ingestion ---

interface Segment {
  start: number;
  end: number;
  text: string;
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

// --- Segments ingestion ---

function ingestSegments(filePath: string): Chunk[] {
  const fileName = path.basename(filePath);
  console.log(`  Reading transcript: ${fileName}`);

  const raw = fs.readFileSync(filePath, "utf-8");
  const segments: Segment[] = JSON.parse(raw);

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
    console.error(`Create it and add PDF/.segments files, then re-run.`);
    process.exit(1);
  }

  const files = fs.readdirSync(resourcesDir);
  const pdfFiles = files.filter((f) => f.toLowerCase().endsWith(".pdf"));
  const segmentFiles = files.filter((f) => f.toLowerCase().endsWith(".segments"));

  if (pdfFiles.length === 0 && segmentFiles.length === 0) {
    console.error(`No .pdf or .segments files found in ${resourcesDir}`);
    process.exit(1);
  }

  console.log(`\nBuilding index for skill: ${skill}`);
  console.log(`Resources: ${pdfFiles.length} PDFs, ${segmentFiles.length} transcripts`);

  // Ingest all files
  let allChunks: Chunk[] = [];

  for (const pf of pdfFiles) {
    const chunks = await ingestPdf(path.join(resourcesDir, pf));
    allChunks.push(...chunks);
  }

  for (const sf of segmentFiles) {
    const chunks = ingestSegments(path.join(resourcesDir, sf));
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
  console.log(`${allChunks.length} chunks from ${pdfFiles.length + segmentFiles.length} files`);
  console.log(`\nNext: ensure skills/${skill}.json exists, then rebuild the MCP server with 'npm run build'`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
