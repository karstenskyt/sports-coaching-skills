import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { SkillIndex } from "./vectordb";
import {
  SkillDefinition,
  listPrinciples,
  searchSkill,
  validateSession,
} from "./tools";

// --- Discover skills ---

function loadSkills(): Map<string, { definition: SkillDefinition; index: SkillIndex }> {
  const skills = new Map<string, { definition: SkillDefinition; index: SkillIndex }>();
  const skillsDir = path.resolve(__dirname, "../../skills");

  if (!fs.existsSync(skillsDir)) {
    console.error(`Skills directory not found: ${skillsDir}`);
    return skills;
  }

  // Collect all JSON files from skills/ and skills/*/ subdirectories
  const jsonFiles: string[] = [];

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      jsonFiles.push(path.join(skillsDir, entry.name));
    } else if (entry.isDirectory()) {
      // Scan subdirectory for JSON files
      const subDir = path.join(skillsDir, entry.name);
      const subFiles = fs.readdirSync(subDir).filter((f) => f.endsWith(".json"));
      for (const subFile of subFiles) {
        jsonFiles.push(path.join(subDir, subFile));
      }
    }
  }

  for (const filePath of jsonFiles) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const definition: SkillDefinition = JSON.parse(raw);

      // Determine which index to use (shared or skill-specific)
      const indexName = definition.sharedIndex || definition.name;
      const dataDir = path.resolve(__dirname, `../../data/${indexName}`);
      const legacyDir = path.resolve(__dirname, "../../data/vectra-index");
      const hasIndex =
        fs.existsSync(path.join(dataDir, "index.json")) ||
        fs.existsSync(path.join(legacyDir, "index.json"));

      if (!hasIndex) {
        console.error(
          `Skipping skill '${definition.name}': no vector index found at '${indexName}'. Run 'npm run build-index -- --skill ${indexName}'`
        );
        continue;
      }

      const index = new SkillIndex(definition.name, definition.sharedIndex);
      skills.set(definition.name, { definition, index });
      const sharedNote = definition.sharedIndex ? ` [shared: ${definition.sharedIndex}]` : "";
      console.error(`Loaded skill: ${definition.displayName} (tools: ${definition.toolPrefix})${sharedNote}`);
    } catch (err) {
      console.error(`Error loading skill from ${filePath}:`, err);
    }
  }

  return skills;
}

// --- Build MCP tools dynamically ---

interface ToolEntry {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  handler: (args: Record<string, any>) => Promise<any>;
}

function buildToolsForSkill(
  definition: SkillDefinition,
  index: SkillIndex
): ToolEntry[] {
  const prefix = definition.toolPrefix;
  const tools: ToolEntry[] = [];

  // search_<prefix>
  tools.push({
    name: `search_${prefix}`,
    description: `Semantic search over ${definition.author}'s materials. ${definition.sourceDescription} Returns relevant passages for a given query.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: `Search query about ${definition.domain} principles`,
        },
        top_k: {
          type: "number",
          description: "Number of results to return (default: 5)",
        },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const results = await searchSkill(index, args.query as string, (args.top_k as number) || 5);
      return results;
    },
  });

  const listName = `list_${prefix}_principles`;
  tools.push({
    name: listName,
    description: `Returns the ${definition.principles.length} core ${definition.displayName} validation principles. Each includes description and validation checks.`,
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    handler: async () => {
      return listPrinciples(definition);
    },
  });

  const validateName = `validate_${prefix}_session`;
  tools.push({
    name: validateName,
    description: `Validates a soccer session plan against ${definition.author}'s ${definition.principles.length} core principles. Returns pass/warning/fail status for each principle with suggestions and relevant passages.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        session_plan: {
          type: "string",
          description: "The full text of the soccer session plan to validate",
        },
      },
      required: ["session_plan"],
    },
    handler: async (args) => {
      return await validateSession(index, definition, args.session_plan as string);
    },
  });

  return tools;
}

// --- Server setup ---

const skills = loadSkills();
const allTools: ToolEntry[] = [];

for (const [, { definition, index }] of skills) {
  allTools.push(...buildToolsForSkill(definition, index));
}

const server = new Server(
  { name: "coaching-skills", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const tool = allTools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const result = await tool.handler(args || {});
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const skillNames = Array.from(skills.keys()).join(", ");
  console.error(`Coaching Skills MCP server running on stdio (skills: ${skillNames})`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
