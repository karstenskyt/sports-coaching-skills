import fs from "fs";
import path from "path";

// --- CLI args ---

function parseArgs(): { skill: string; sampleSize?: number } {
  const args = process.argv.slice(2);
  const skillIdx = args.indexOf("--skill");
  if (skillIdx === -1 || skillIdx + 1 >= args.length) {
    console.error("Usage: npm run analyze-resources -- --skill <skill-name> [--samples <n>]");
    console.error("Example: npm run analyze-resources -- --skill author-name --samples 15");
    process.exit(1);
  }

  let sampleSize = 15; // default
  const samplesIdx = args.indexOf("--samples");
  if (samplesIdx !== -1 && samplesIdx + 1 < args.length) {
    sampleSize = parseInt(args[samplesIdx + 1], 10);
  }

  return { skill: args[skillIdx + 1], sampleSize };
}

// --- Types ---

interface ChunkMetadata {
  text: string;
  chapter: string;
  page: number;
  source: string;
}

interface IndexItem {
  id: string;
  metadata: ChunkMetadata;
  vector: number[];
}

interface VectraIndex {
  version: number;
  metadata_config: Record<string, unknown>;
  items: IndexItem[];
}

interface DocumentInfo {
  filename: string;
  chunks: number;
  chapters: string[];
  pageRange: { min: number; max: number };
}

interface ContentSample {
  source: string;
  chapter: string;
  page: number;
  text: string;
}

interface SkillProposal {
  meta: {
    source_folder: string;
    generated_at: string;
    index_chunks: number;
    documents_count: number;
  };
  documents: DocumentInfo[];
  content_samples: ContentSample[];
  detected_themes: {
    theme: string;
    frequency: number;
    sample_chapters: string[];
  }[];
  instructions: string;
}

// --- Analysis functions ---

function loadVectraIndex(indexPath: string): VectraIndex {
  const indexFile = path.join(indexPath, "index.json");
  if (!fs.existsSync(indexFile)) {
    throw new Error(`Index not found at ${indexFile}`);
  }
  const raw = fs.readFileSync(indexFile, "utf-8");
  return JSON.parse(raw);
}

function analyzeDocuments(items: IndexItem[]): DocumentInfo[] {
  const bySource = new Map<string, IndexItem[]>();

  for (const item of items) {
    const source = item.metadata.source;
    if (!bySource.has(source)) {
      bySource.set(source, []);
    }
    bySource.get(source)!.push(item);
  }

  const docs: DocumentInfo[] = [];
  for (const [filename, chunks] of bySource) {
    const chapters = [...new Set(chunks.map((c) => c.metadata.chapter))];
    const pages = chunks.map((c) => c.metadata.page);
    docs.push({
      filename,
      chunks: chunks.length,
      chapters: chapters.sort(),
      pageRange: {
        min: Math.min(...pages),
        max: Math.max(...pages),
      },
    });
  }

  return docs.sort((a, b) => b.chunks - a.chunks);
}

function sampleChunks(items: IndexItem[], sampleSize: number): ContentSample[] {
  // Stratified sampling: take proportionally from each document
  const bySource = new Map<string, IndexItem[]>();
  for (const item of items) {
    const source = item.metadata.source;
    if (!bySource.has(source)) {
      bySource.set(source, []);
    }
    bySource.get(source)!.push(item);
  }

  const samples: ContentSample[] = [];
  const sources = [...bySource.keys()];
  const perSource = Math.max(1, Math.floor(sampleSize / sources.length));

  for (const source of sources) {
    const chunks = bySource.get(source)!;
    // Sort by page to get a spread across the document
    chunks.sort((a, b) => a.metadata.page - b.metadata.page);

    // Take evenly spaced samples
    const step = Math.max(1, Math.floor(chunks.length / perSource));
    for (let i = 0; i < chunks.length && samples.length < sampleSize; i += step) {
      const chunk = chunks[i];
      samples.push({
        source: chunk.metadata.source,
        chapter: chunk.metadata.chapter,
        page: chunk.metadata.page,
        // Truncate to first 800 chars for readability
        text: chunk.metadata.text.substring(0, 800) + (chunk.metadata.text.length > 800 ? "..." : ""),
      });
      if (samples.filter((s) => s.source === source).length >= perSource) break;
    }
  }

  return samples.slice(0, sampleSize);
}

function detectThemes(items: IndexItem[]): { theme: string; frequency: number; sample_chapters: string[] }[] {
  // Extract unique chapters and count occurrences
  const chapterCounts = new Map<string, number>();
  for (const item of items) {
    const chapter = item.metadata.chapter;
    chapterCounts.set(chapter, (chapterCounts.get(chapter) || 0) + 1);
  }

  // Group similar chapters by extracting key terms
  const themeGroups = new Map<string, { chapters: string[]; count: number }>();

  for (const [chapter, count] of chapterCounts) {
    // Extract a theme key from the chapter name
    // Remove "Chapter X:", "Part X:", "Rule X:", common prefixes, and numbers
    let themeKey = chapter
      .replace(/^(Chapter|CHAPTER|Part|PART|Rule|RULE|Section|SECTION)\s*\d+[:\s]*/i, "")
      .replace(/^Transcript @.*/, "Transcript")
      .replace(/^\d+[\.:]\s*/, "")
      .trim();

    // Normalize to lowercase for grouping
    const normalizedKey = themeKey.toLowerCase().substring(0, 50);

    if (!themeGroups.has(normalizedKey)) {
      themeGroups.set(normalizedKey, { chapters: [], count: 0 });
    }
    const group = themeGroups.get(normalizedKey)!;
    group.chapters.push(chapter);
    group.count += count;
  }

  // Convert to array and sort by frequency
  const themes = [...themeGroups.entries()]
    .map(([theme, data]) => ({
      theme: theme || "General Content",
      frequency: data.count,
      sample_chapters: data.chapters.slice(0, 3),
    }))
    .filter((t) => t.theme !== "transcript" && t.theme.length > 2)
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 15); // Top 15 themes

  return themes;
}

// --- Main ---

async function main() {
  const { skill, sampleSize } = parseArgs();
  const resourcesDir = path.resolve(process.cwd(), "resources", skill);
  const indexPath = path.resolve(process.cwd(), "data", skill);
  const proposalPath = path.resolve(process.cwd(), "drafts", `${skill}.skill-proposal.json`);

  // Check resources folder exists
  if (!fs.existsSync(resourcesDir)) {
    console.error(`Resources directory not found: ${resourcesDir}`);
    console.error(`Create it and add PDF/transcript files first.`);
    process.exit(1);
  }

  // Check index exists
  if (!fs.existsSync(path.join(indexPath, "index.json"))) {
    console.error(`Vector index not found at: ${indexPath}`);
    console.error(`Run 'npm run build-index -- --skill ${skill}' first.`);
    process.exit(1);
  }

  console.log(`\nAnalyzing resources for: ${skill}`);

  // Load the vector index
  console.log("Loading vector index...");
  const index = loadVectraIndex(indexPath);
  console.log(`  ${index.items.length} chunks loaded`);

  // Analyze documents
  console.log("Analyzing documents...");
  const documents = analyzeDocuments(index.items);
  for (const doc of documents) {
    console.log(`  ${doc.filename}: ${doc.chunks} chunks, ${doc.chapters.length} chapters`);
  }

  // Sample representative chunks
  console.log(`Sampling ${sampleSize} representative chunks...`);
  const samples = sampleChunks(index.items, sampleSize!);

  // Detect themes
  console.log("Detecting themes from chapter structure...");
  const themes = detectThemes(index.items);
  console.log(`  Found ${themes.length} distinct themes`);

  // Build proposal
  const proposal: SkillProposal = {
    meta: {
      source_folder: skill,
      generated_at: new Date().toISOString(),
      index_chunks: index.items.length,
      documents_count: documents.length,
    },
    documents,
    content_samples: samples,
    detected_themes: themes,
    instructions: `
This skill proposal was auto-generated from the vector index for '${skill}'.

To create skills from this proposal:

1. Review the 'documents' section to understand what source materials are available.

2. Review the 'content_samples' section - these are representative excerpts from the materials.
   Use these to understand the author's key concepts and terminology.

3. Review the 'detected_themes' section - these are potential topic areas for sub-skills.

4. Ask Claude to help you create skill definitions:
   "Based on this skill proposal, suggest 3-5 focused sub-skills with principles and checks."

5. For each suggested skill, Claude can generate a draft using:
   meta_generate_draft tool

6. Review drafts in the 'drafts/' folder, then finalize with:
   meta_finalize_skill tool

Tips:
- Each sub-skill should have a clear, focused theme (e.g., "Feedback Delivery", "Session Design")
- Principles should be actionable coaching concepts from the source materials
- Checks should be yes/no questions that can be answered from a session plan
- Include [cite: page] references in checks when possible
- Use 'sharedIndex' to have all sub-skills share the '${skill}' vector index
`.trim(),
  };

  // Ensure drafts directory exists
  const draftsDir = path.dirname(proposalPath);
  fs.mkdirSync(draftsDir, { recursive: true });

  // Write proposal
  fs.writeFileSync(proposalPath, JSON.stringify(proposal, null, 2));
  console.log(`\nProposal written to: ${proposalPath}`);
  console.log(`\nNext steps:`);
  console.log(`1. Review the proposal file`);
  console.log(`2. Ask Claude to help create skills based on the proposal`);
  console.log(`3. Use meta_generate_draft and meta_finalize_skill tools`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
