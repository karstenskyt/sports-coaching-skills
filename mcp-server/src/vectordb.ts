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

