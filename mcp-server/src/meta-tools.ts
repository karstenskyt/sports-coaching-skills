/**
 * Meta-tools for skill building - helps create and manage skill definitions.
 * These tools are for authoring skills, not for evaluation.
 */

import fs from "fs";
import path from "path";

// --- Types ---

export interface SkillProposal {
  meta: {
    source_folder: string;
    generated_at: string;
    index_chunks: number;
    documents_count: number;
  };
  documents: {
    filename: string;
    chunks: number;
    chapters: string[];
    pageRange: { min: number; max: number };
  }[];
  content_samples: {
    source: string;
    chapter: string;
    page: number;
    text: string;
  }[];
  detected_themes: {
    theme: string;
    frequency: number;
    sample_chapters: string[];
  }[];
  instructions: string;
}

export interface DraftSkillSpec {
  name: string;
  displayName: string;
  author: string;
  authorDescription: string;
  domain: string;
  toolPrefix: string;
  sourceDescription: string;
  sharedIndex?: string;
  principles: {
    name: string;
    description: string;
    checks: string[];
  }[];
}

// --- Path helpers ---

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DRAFTS_DIR = path.join(PROJECT_ROOT, "drafts");
const SKILLS_DIR = path.join(PROJECT_ROOT, "skills");
const RESOURCES_DIR = path.join(PROJECT_ROOT, "resources");
const DATA_DIR = path.join(PROJECT_ROOT, "data");

// --- Tool implementations ---

/**
 * List all available resource folders that can be analyzed.
 */
export function listResourceFolders(): { folders: string[]; with_index: string[]; without_index: string[] } {
  if (!fs.existsSync(RESOURCES_DIR)) {
    return { folders: [], with_index: [], without_index: [] };
  }

  const entries = fs.readdirSync(RESOURCES_DIR, { withFileTypes: true });
  const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const with_index: string[] = [];
  const without_index: string[] = [];

  for (const folder of folders) {
    const indexPath = path.join(DATA_DIR, folder, "index.json");
    if (fs.existsSync(indexPath)) {
      with_index.push(folder);
    } else {
      without_index.push(folder);
    }
  }

  return { folders, with_index, without_index };
}

/**
 * List all proposal files in the drafts folder.
 */
export function listProposals(): { proposals: string[]; drafts: string[] } {
  if (!fs.existsSync(DRAFTS_DIR)) {
    return { proposals: [], drafts: [] };
  }

  const files = fs.readdirSync(DRAFTS_DIR);
  const proposals = files.filter((f) => f.endsWith(".skill-proposal.json"));
  const drafts = files.filter((f) => f.endsWith(".draft.json"));

  return { proposals, drafts };
}

/**
 * Read a skill proposal file.
 */
export function readProposal(skillName: string): SkillProposal | { error: string } {
  const proposalPath = path.join(DRAFTS_DIR, `${skillName}.skill-proposal.json`);

  if (!fs.existsSync(proposalPath)) {
    return { error: `Proposal not found: ${proposalPath}. Run 'npm run analyze-resources -- --skill ${skillName}' first.` };
  }

  const raw = fs.readFileSync(proposalPath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Generate a draft skill JSON file from a specification.
 */
export function generateDraft(spec: DraftSkillSpec): { success: boolean; path?: string; error?: string } {
  // Validate required fields
  if (!spec.name || !spec.displayName || !spec.author || !spec.toolPrefix || !spec.principles) {
    return { success: false, error: "Missing required fields: name, displayName, author, toolPrefix, principles" };
  }

  // Validate principles
  if (!Array.isArray(spec.principles) || spec.principles.length === 0) {
    return { success: false, error: "At least one principle is required" };
  }

  for (const p of spec.principles) {
    if (!p.name || !p.description || !p.checks || p.checks.length === 0) {
      return { success: false, error: `Invalid principle '${p.name || "unnamed"}': needs name, description, and at least one check` };
    }
  }

  // Ensure drafts directory exists
  fs.mkdirSync(DRAFTS_DIR, { recursive: true });

  // Write draft file
  const draftPath = path.join(DRAFTS_DIR, `${spec.name}.draft.json`);
  const skillDef = {
    name: spec.name,
    displayName: spec.displayName,
    author: spec.author,
    authorDescription: spec.authorDescription || "",
    domain: spec.domain || "coaching-pedagogy",
    toolPrefix: spec.toolPrefix,
    sourceDescription: spec.sourceDescription || `Semantic search over ${spec.author}'s materials.`,
    ...(spec.sharedIndex && { sharedIndex: spec.sharedIndex }),
    principles: spec.principles,
  };

  fs.writeFileSync(draftPath, JSON.stringify(skillDef, null, 2));

  return { success: true, path: draftPath };
}

/**
 * Read a draft skill file.
 */
export function readDraft(draftName: string): DraftSkillSpec | { error: string } {
  // Handle both "name" and "name.draft.json" formats
  const baseName = draftName.replace(/\.draft\.json$/, "");
  const draftPath = path.join(DRAFTS_DIR, `${baseName}.draft.json`);

  if (!fs.existsSync(draftPath)) {
    return { error: `Draft not found: ${draftPath}` };
  }

  const raw = fs.readFileSync(draftPath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Finalize a draft by moving it to the skills folder.
 * Optionally place in a subdirectory (e.g., for shared index skills).
 */
export function finalizeDraft(
  draftName: string,
  options?: { subdirectory?: string }
): { success: boolean; path?: string; error?: string } {
  // Handle both "name" and "name.draft.json" formats
  const baseName = draftName.replace(/\.draft\.json$/, "");
  const draftPath = path.join(DRAFTS_DIR, `${baseName}.draft.json`);

  if (!fs.existsSync(draftPath)) {
    return { success: false, error: `Draft not found: ${draftPath}` };
  }

  // Read and validate draft
  const raw = fs.readFileSync(draftPath, "utf-8");
  let skillDef: DraftSkillSpec;
  try {
    skillDef = JSON.parse(raw);
  } catch {
    return { success: false, error: `Invalid JSON in draft: ${draftPath}` };
  }

  // Determine target path
  let targetDir = SKILLS_DIR;
  if (options?.subdirectory) {
    targetDir = path.join(SKILLS_DIR, options.subdirectory);
  }
  fs.mkdirSync(targetDir, { recursive: true });

  const targetPath = path.join(targetDir, `${baseName}.json`);

  // Check if target already exists
  if (fs.existsSync(targetPath)) {
    return { success: false, error: `Skill already exists: ${targetPath}. Delete it first or use a different name.` };
  }

  // Write to skills folder
  fs.writeFileSync(targetPath, JSON.stringify(skillDef, null, 2));

  // Remove draft
  fs.unlinkSync(draftPath);

  return { success: true, path: targetPath };
}

/**
 * Delete a draft file.
 */
export function deleteDraft(draftName: string): { success: boolean; error?: string } {
  const baseName = draftName.replace(/\.draft\.json$/, "");
  const draftPath = path.join(DRAFTS_DIR, `${baseName}.draft.json`);

  if (!fs.existsSync(draftPath)) {
    return { success: false, error: `Draft not found: ${draftPath}` };
  }

  fs.unlinkSync(draftPath);
  return { success: true };
}

// --- MCP Tool Definitions ---

export interface MetaToolEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export function getMetaTools(): MetaToolEntry[] {
  return [
    {
      name: "meta_list_resources",
      description:
        "List available resource folders for skill building. Shows which folders have vector indices built and which need indexing.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      handler: async () => listResourceFolders(),
    },
    {
      name: "meta_list_proposals",
      description:
        "List existing skill proposals and drafts in the drafts/ folder. Proposals are generated by analyze-resources, drafts are skill definitions awaiting finalization.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      handler: async () => listProposals(),
    },
    {
      name: "meta_read_proposal",
      description:
        "Read a skill proposal file to understand the source materials and get content samples for creating skill definitions.",
      inputSchema: {
        type: "object",
        properties: {
          skill_name: {
            type: "string",
            description: "Name of the skill/resource folder (e.g., 'author-name')",
          },
        },
        required: ["skill_name"],
      },
      handler: async (args) => readProposal(args.skill_name as string),
    },
    {
      name: "meta_generate_draft",
      description:
        "Generate a draft skill definition JSON file. The draft is saved to drafts/ for review before finalization.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Kebab-case skill identifier (e.g., 'author-topic-name')",
          },
          displayName: {
            type: "string",
            description: "Human-readable skill name",
          },
          author: {
            type: "string",
            description: "Author of the source materials",
          },
          authorDescription: {
            type: "string",
            description: "Brief bio and expertise area",
          },
          domain: {
            type: "string",
            description: "Topic domain (e.g., 'sport-psychology', 'coaching-pedagogy')",
          },
          toolPrefix: {
            type: "string",
            description: "Short prefix for MCP tool names (e.g., 'abrahams')",
          },
          sourceDescription: {
            type: "string",
            description: "Description of what the semantic search covers",
          },
          sharedIndex: {
            type: "string",
            description: "Optional: name of shared vector index to use instead of skill-specific index",
          },
          principles: {
            type: "array",
            description: "Array of 3-5 principles with name, description, and checks",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Principle name" },
                description: { type: "string", description: "What the principle means" },
                checks: {
                  type: "array",
                  items: { type: "string" },
                  description: "2-4 yes/no validation questions",
                },
              },
              required: ["name", "description", "checks"],
            },
          },
        },
        required: ["name", "displayName", "author", "toolPrefix", "principles"],
      },
      handler: async (args) => generateDraft(args as unknown as DraftSkillSpec),
    },
    {
      name: "meta_read_draft",
      description: "Read an existing draft skill definition for review or modification.",
      inputSchema: {
        type: "object",
        properties: {
          draft_name: {
            type: "string",
            description: "Name of the draft (with or without .draft.json extension)",
          },
        },
        required: ["draft_name"],
      },
      handler: async (args) => readDraft(args.draft_name as string),
    },
    {
      name: "meta_finalize_draft",
      description:
        "Finalize a draft by moving it from drafts/ to skills/. Optionally place in a subdirectory for organization.",
      inputSchema: {
        type: "object",
        properties: {
          draft_name: {
            type: "string",
            description: "Name of the draft to finalize (with or without .draft.json extension)",
          },
          subdirectory: {
            type: "string",
            description: "Optional subdirectory under skills/ (e.g., 'author-name' for shared index skills)",
          },
        },
        required: ["draft_name"],
      },
      handler: async (args) =>
        finalizeDraft(args.draft_name as string, {
          subdirectory: args.subdirectory as string | undefined,
        }),
    },
    {
      name: "meta_delete_draft",
      description: "Delete a draft skill definition.",
      inputSchema: {
        type: "object",
        properties: {
          draft_name: {
            type: "string",
            description: "Name of the draft to delete (with or without .draft.json extension)",
          },
        },
        required: ["draft_name"],
      },
      handler: async (args) => deleteDraft(args.draft_name as string),
    },
  ];
}
