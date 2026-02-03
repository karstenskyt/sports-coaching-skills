import { LocalIndex } from "vectra";
import path from "path";
import fs from "fs";

// We'll use a dynamic import for transformers.js since it's ESM
let embedPipeline: any = null;

async function getEmbedder() {
  if (!embedPipeline) {
    const { pipeline } = await import("@xenova/transformers");
    embedPipeline = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
  }
  return embedPipeline;
}

export async function embedText(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  const result = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(result.data as Float32Array);
}

export interface SearchResult {
  text: string;
  chapter?: string;
  page?: number;
  score: number;
}

/**
 * Split text into semantic chunks (sentences/paragraphs) for embedding comparison.
 * Aims for chunks of roughly 100-300 characters for good semantic granularity.
 */
export function splitIntoChunks(text: string, maxChunkSize = 300): string[] {
  // First split by paragraphs (double newline or single newline with content)
  const paragraphs = text.split(/\n\s*\n|\n(?=[A-Z])/).filter((p) => p.trim().length > 0);

  const chunks: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= maxChunkSize) {
      chunks.push(para.trim());
    } else {
      // Split long paragraphs by sentences
      const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
      let current = "";

      for (const sentence of sentences) {
        if (current.length + sentence.length <= maxChunkSize) {
          current += sentence;
        } else {
          if (current.trim()) chunks.push(current.trim());
          current = sentence;
        }
      }
      if (current.trim()) chunks.push(current.trim());
    }
  }

  return chunks.filter((c) => c.length > 20); // Filter out very short chunks
}

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Find the most semantically similar chunks to a query.
 * Returns chunks with their similarity scores, sorted by relevance.
 */
export async function findSimilarChunks(
  chunks: string[],
  query: string,
  topK = 3
): Promise<Array<{ text: string; score: number }>> {
  const queryEmbedding = await embedText(query);

  // Embed all chunks (batch for efficiency)
  const chunkResults: Array<{ text: string; score: number }> = [];

  for (const chunk of chunks) {
    const chunkEmbedding = await embedText(chunk);
    const score = cosineSimilarity(queryEmbedding, chunkEmbedding);
    chunkResults.push({ text: chunk, score });
  }

  // Sort by score descending and return top K
  return chunkResults.sort((a, b) => b.score - a.score).slice(0, topK);
}

export class SkillIndex {
  private index: LocalIndex;
  private ready = false;
  public readonly skillName: string;
  public readonly indexName: string;

  /**
   * @param skillName - The skill's name (used for error messages)
   * @param sharedIndex - Optional: use a shared index instead of skill-specific one
   * @param indexPath - Optional: explicit path to the index directory
   */
  constructor(skillName: string, sharedIndex?: string, indexPath?: string) {
    this.skillName = skillName;
    this.indexName = sharedIndex || skillName;
    const resolvedPath =
      indexPath || this.resolveIndexPath(this.indexName);
    this.index = new LocalIndex(resolvedPath);
  }

  private resolveIndexPath(indexName: string): string {
    // Primary: data/<index-name>/
    const primary = path.resolve(__dirname, `../../data/${indexName}`);
    if (fs.existsSync(path.join(primary, "index.json"))) {
      return primary;
    }
    // Legacy fallback: data/vectra-index/
    const legacy = path.resolve(__dirname, "../../data/vectra-index");
    if (fs.existsSync(path.join(legacy, "index.json"))) {
      return legacy;
    }
    // Return primary path even if it doesn't exist yet (will error on init)
    return primary;
  }

  async init(): Promise<void> {
    if (this.ready) return;
    if (!(await this.index.isIndexCreated())) {
      throw new Error(
        `Vector index not found for skill '${this.skillName}'. Run 'npm run build-index -- --skill ${this.skillName}' first.`
      );
    }
    this.ready = true;
  }

  async search(query: string, topK = 5): Promise<SearchResult[]> {
    await this.init();
    const queryVector = await embedText(query);
    const results = await this.index.queryItems(queryVector, topK);
    return results.map((r) => ({
      text: r.item.metadata.text as string,
      chapter: r.item.metadata.chapter as string | undefined,
      page: r.item.metadata.page as number | undefined,
      score: r.score,
    }));
  }
}

