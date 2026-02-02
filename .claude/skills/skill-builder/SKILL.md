# Skill Builder

## Description
Creates new coaching/analysis skills from resource documents (PDFs, transcripts). Ingests materials into a vector database, generates a skill definition with principles and validation checks, and registers it with the MCP server.

## Trigger
- "create a skill", "build a skill", "new skill from resources"
- "create skill from resources/<name>"
- Any request to create a new coaching skill from available materials

## Prerequisites
- Resource documents must be placed in `resources/<skill-name>/`
- Supported formats: `.pdf` (books, articles), `.srt` / `.vtt` (subtitle transcripts), `.json` (timestamped segments)

## Workflow: Creating a New Skill

### Step 1: Identify resources
Check `resources/<skill-name>/` for available materials. List what's there.

### Step 2: Ingest resources into vector database
Run the build-index script:
```
npm run build-index -- --skill <skill-name>
```
This reads all `.pdf` and transcript files (`.srt`, `.vtt`, `.json`), chunks them, embeds with all-MiniLM-L6-v2, and stores in `data/<skill-name>/index.json`.

### Step 3: Explore the content
After ingestion, the vector index is available. Read sample passages to understand the author's key themes, frameworks, and principles. Optionally search online for additional context about the author.

### Step 4: Design the skill definition
Create `skills/<skill-name>.json` with:
- `name`: Kebab-case identifier (matches folder name)
- `displayName`: Human-readable name
- `author`: Author name
- `authorDescription`: Brief bio and expertise area
- `domain`: Topic domain (e.g., "sport-psychology", "coaching-pedagogy")
- `toolPrefix`: Short prefix for MCP tool names
- `sourceDescription`: What the search covers
- `principles`: Array of 3-5 core principles, each with name, description, and 3 validation checks

**Get user approval on the principles before proceeding.**

### Step 5: Build the MCP server
```
npm run build
```
The server dynamically discovers all skills in `skills/*.json` that have matching vector indexes in `data/`.

### Step 6: Generate SKILL.md
Create `.claude/skills/<skill-name>/SKILL.md` documenting:
- Available tools (`search_<prefix>`, `list_<prefix>_principles`, `validate_<prefix>_session`)
- The skill's principles and what they check
- Workflow guidance for using the skill

### Step 7: Update permissions
Add MCP tool permissions to `.claude/settings.local.json` for the new tools.

### Step 8: Restart Claude Code
The new MCP tools become available after restart.

## Skill Definition Schema

```json
{
  "name": "goalkeeping-coach",
  "displayName": "Goalkeeping Coaching Principles",
  "author": "Author Name",
  "authorDescription": "Brief bio...",
  "domain": "coaching-pedagogy",
  "toolPrefix": "gkcoach",
  "sourceDescription": "What the semantic search covers.",
  "principles": [
    {
      "name": "Principle Name",
      "description": "What this principle means and why it matters.",
      "checks": [
        "First validation question?",
        "Second validation question?",
        "Third validation question?"
      ]
    }
  ]
}
```

## Tool Naming Convention
For a skill with `toolPrefix: "gkcoach"`:
- `search_gkcoach(query, top_k)` — Semantic search
- `list_gkcoach_principles()` — List principles
- `validate_gkcoach_session(session_plan)` — Validate against principles

## Available Skills
Check `skills/` directory for all skill definitions. Check `data/` for which have been indexed.

## Notes
- Resource documents in `resources/` are only needed during ingestion. All knowledge is stored in the vector database for runtime retrieval.
- Transcripts can be `.srt` (SubRip), `.vtt` (WebVTT), or `.json` arrays of `{start, end, text}` objects.
- Each skill's vector index is independent. Rebuilding one doesn't affect others.
- The MCP server serves ALL skills from a single process.
