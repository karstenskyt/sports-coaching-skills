# Sports Coaching Skills

A platform for validating and evaluating coaching sessions against configurable frameworks. Built on the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) and designed to work with [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

## What It Does

- **Semantic search** over coaching books, articles, and training transcripts using local vector embeddings
- **Session validation** against author-defined coaching principles (pass/warning/fail per principle)
- **Tactical diagram rendering** with players, movement arrows, and zones on a soccer pitch
- **Spatial evaluation** of training activities (area-per-player metrics and intensity profiling)
- **PDF compilation** combining evaluation text, diagrams, and evidence into professional reports

Each coaching framework is packaged as a **skill** — a JSON definition paired with a vector index built from the author's source materials. The platform supports any number of skills, each independently searchable and validatable.

## Architecture

[Interactive architecture diagram](architecture.html) — open locally to explore data flows.

```
sports-coaching-skills/
├── mcp-server/          # Node.js MCP server (validation + semantic search)
├── diagram-server/      # Python MCP server (diagrams + PDFs)
├── scripts/             # Indexing and test scripts
├── skills/              # Skill definitions (*.json, gitignored)
│   ├── <skill-name>.json
│   └── <author>/        # Skills can be organized in subdirectories
│       ├── <skill-topic-1>.json
│       └── <skill-topic-2>.json
├── resources/           # Source PDFs and transcripts (gitignored)
├── data/                # Vector indices (gitignored)
├── samples/             # Sample session plans and transcripts
├── templates/           # Reusable output templates (improvement plans, reports)
└── output/              # Generated diagrams and PDFs
```

**Two MCP servers** run simultaneously:

| Server | Language | Purpose |
|--------|----------|---------|
| `coaching-skills` | Node.js / TypeScript | Semantic search, principle listing, session validation |
| `soccer-diagrams` | Python | Tactical diagrams, spatial evaluation, PDF compilation |

The coaching-skills server dynamically discovers all skill definitions in `skills/` and its subdirectories at startup and registers three tools per skill. Multiple skills can share a single vector index via the `sharedIndex` property.

## Prerequisites

- **Node.js** >= 18
- **Python** >= 3.11
- **Claude Code** (for using the MCP tools interactively)

## Setup

### 1. Install Node.js dependencies

```bash
npm install
cd mcp-server && npm install && cd ..
```

### 2. Set up the Python diagram server

```bash
cd diagram-server
python -m venv .venv
.venv/Scripts/python -m ensurepip     # Windows  (ensures pip is available)
.venv/Scripts/python -m pip install -e .
# .venv/bin/python -m ensurepip       # macOS/Linux
# .venv/bin/python -m pip install -e .
cd ..
```

### 3. Build the MCP server

```bash
npm run build
```

### 4. Add a skill

See [Adding a New Skill](#adding-a-new-skill) below.

### 5. Restart Claude Code

The MCP servers are configured in `.mcp.json` and start automatically when Claude Code launches.

## Adding a New Skill

A skill wraps a coaching framework (book, course, transcript collection) into searchable, validatable tools. The process has four stages: prepare resources, build the vector index, write the skill definition, and rebuild.

### Step 1: Prepare resources

Create a folder under `resources/` named after your skill:

```
resources/goalkeeping-coach/
├── coaching-book.pdf
├── advanced-techniques.pdf
└── classroom-session.segments
```

Supported formats:

| Format | Description |
|--------|-------------|
| `.pdf` | Books, articles, manuals |
| `.srt` | SubRip subtitles (from speech-to-text transcription) |
| `.vtt` | WebVTT subtitles |
| `.json` | JSON arrays of `[{start, end, text}, ...]` |

### Step 2: Build the vector index

```bash
npm run build-index -- --skill goalkeeping-coach
```

This reads all files in `resources/goalkeeping-coach/`, chunks the text (500 words, 50-word overlap), embeds each chunk with [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) (384-dim vectors), and writes the index to `data/goalkeeping-coach/`.

The embedding model (~90 MB) downloads automatically on first run.

### Step 3: Write the skill definition

Create `skills/goalkeeping-coach.json` (or organize in a subdirectory like `skills/goalkeeping/gk-positioning.json`):

```json
{
  "name": "goalkeeping-coach",
  "displayName": "Goalkeeping Coaching Principles",
  "author": "Author Name",
  "authorDescription": "Brief bio and area of expertise.",
  "domain": "coaching-pedagogy",
  "toolPrefix": "gkcoach",
  "sourceDescription": "Semantic search over 'Goalkeeping Mastery' and classroom transcripts.",
  "principles": [
    {
      "name": "Positioning",
      "description": "Goalkeepers must adopt correct starting positions relative to the ball, goal, and opponents.",
      "checks": [
        "Does the session include exercises that train starting position awareness?",
        "Are there progressions that vary the angle and distance of the shot?",
        "Does the session address recovery positioning after a save?"
      ]
    }
  ]
}
```

**Fields:**

| Field | Description |
|-------|-------------|
| `name` | Kebab-case identifier, must match the `resources/` and `data/` folder name (unless using `sharedIndex`) |
| `displayName` | Human-readable name shown in tool descriptions |
| `author` | Author of the source materials |
| `authorDescription` | Short bio for context |
| `domain` | Topic area (e.g. `sport-psychology`, `coaching-pedagogy`) |
| `toolPrefix` | Short prefix for generated MCP tool names |
| `sourceDescription` | Describes what the semantic search covers |
| `sharedIndex` | *(Optional)* Name of a shared vector index in `data/`. Allows multiple skills to use one index. |
| `principles` | Array of 3-5 principles, each with `name`, `description`, and `checks` |

Each check is a yes/no question used during validation. The validator uses semantic similarity (embedding-based comparison) to find evidence for each check in the session text, returning confidence scores and matching excerpts.

#### Shared Vector Indices

Multiple skills can share a single vector index by specifying `sharedIndex`. This is useful when you want granular skill definitions (e.g., different coaching topics) that all draw from the same source materials:

```json
{
  "name": "author-topic-a",
  "sharedIndex": "author-name",
  "toolPrefix": "topica",
  ...
}
```

With this configuration:
- The skill uses `data/author-name/` for semantic search instead of `data/author-topic-a/`
- Run `npm run build-index -- --skill author-name` once to build the shared index
- Multiple skills in `skills/author-name/` can all reference `"sharedIndex": "author-name"`

### Step 4: Rebuild and restart

```bash
npm run build
```

Restart Claude Code. Three new MCP tools will appear:

| Tool | Description |
|------|-------------|
| `search_gkcoach(query, top_k)` | Semantic search over the skill's indexed materials |
| `list_gkcoach_principles()` | Returns the skill's principles and validation checks |
| `validate_gkcoach_session(session_plan)` | Validates a session plan against all principles |

### Step 5 (optional): Add a Claude Code skill

Create `.claude/skills/<skill-name>/SKILL.md` to teach Claude Code how to use the new tools effectively. See the existing skills under `.claude/skills/` for examples.

Update `.claude/settings.local.json` to allow the new MCP tool permissions:

```json
{
  "permissions": {
    "allow": [
      "mcp__coaching-skills__search_*",
      "mcp__coaching-skills__list_*",
      "mcp__coaching-skills__validate_*"
    ]
  }
}
```

## Assisted Skill Creation

Creating skill definitions manually can be time-consuming. The platform includes tools to help analyze source materials and generate skill drafts.

### Workflow

```
1. Prepare resources     → resources/<author-name>/
2. Build vector index    → npm run build-index -- --skill <author-name>
3. Analyze resources     → npm run analyze-resources -- --skill <author-name>
4. Review proposal       → drafts/<author-name>.skill-proposal.json
5. Generate drafts       → Use meta_generate_draft tool with Claude's help
6. Review & finalize     → Use meta_finalize_draft tool
```

### Step 1: Analyze Resources

After building the vector index, run:

```bash
npm run analyze-resources -- --skill author-name --samples 15
```

This generates `drafts/author-name.skill-proposal.json` containing:
- **Document inventory**: Files, chunk counts, detected chapters
- **Content samples**: Representative excerpts for understanding the material
- **Detected themes**: Potential topic areas for sub-skills
- **Instructions**: Guidance for creating skills from the proposal

### Step 2: Create Skills with Claude

Ask Claude to help create skills based on the proposal:

> "Read the skill proposal at drafts/author-name.skill-proposal.json and suggest 3-4 focused sub-skills with principles and checks."

Claude can use the meta-tools to:
1. Read the proposal (`meta_read_proposal`)
2. Generate draft skills (`meta_generate_draft`)
3. Finalize approved drafts (`meta_finalize_draft`)

### Step 3: Review and Finalize

Drafts are saved to `drafts/` for review before becoming active skills. Use `meta_finalize_draft` to move approved drafts to `skills/`.

### Meta-Tools Reference

| Tool | Purpose |
|------|---------|
| `meta_list_resources` | List resource folders and their index status |
| `meta_list_proposals` | List existing proposals and drafts |
| `meta_read_proposal` | Read a skill proposal for analysis |
| `meta_generate_draft` | Create a draft skill definition |
| `meta_read_draft` | Read an existing draft for review |
| `meta_finalize_draft` | Move a draft to the skills folder |
| `meta_delete_draft` | Delete a draft |

## Templates

Reusable templates for common outputs live in `templates/`. These provide consistent formatting for reports and improvement plans generated from validation results.

### Available Templates

| Template | Purpose |
|----------|---------|
| `improvement-plan.md` | Unified improvement plan combining recommendations from multiple skill frameworks |

### Improvement Plan Template

After validating a session against multiple skill frameworks, use this template to synthesize recommendations into a single actionable plan.

**Key sections:**
- **Integrated Recommendations** — Priority table mapping improvements to source principles across frameworks
- **Improvement Details** — Individual improvements with components, rationale, and framework connections
- **Revised Session Flow** — Tree-diagram visualization of the improved session
- **Summary** — Thematic overview of changes and expected benefits

**Usage:** Copy the template structure and fill in based on validation results. The template includes guidelines for adapting to different numbers of frameworks and recommended improvement counts.

## MCP Tools Reference

### Coaching Skills Server

Generated dynamically per skill. For a skill with `toolPrefix: "example"`:

| Tool | Parameters | Returns |
|------|------------|---------|
| `search_example` | `query` (string), `top_k` (number, default 5) | Array of `{text, chapter, page, score}` |
| `list_example_principles` | none | Array of `{name, description, checks}` |
| `validate_example_session` | `session_plan` (string) | See Validation Result Schema below |

**Validation Result Schema:**

```json
{
  "overall": "Summary message with confidence percentage",
  "summary": {
    "pass": 3,
    "warning": 1,
    "fail": 1,
    "averageConfidence": 0.52
  },
  "principles": [{
    "name": "Principle Name",
    "description": "What the principle means",
    "status": "pass | warning | fail",
    "confidence": 0.65,
    "findings": "2 pass, 1 warn, 0 fail (confidence: 65%)",
    "checks": [{
      "question": "The yes/no check question?",
      "score": 0.72,
      "status": "pass",
      "evidence": ["Matching excerpt from session...", "Another relevant excerpt..."]
    }],
    "suggestions": ["Strengthen: Check that scored as warning", "Missing: Check that failed"],
    "relevantPassages": [{"text": "...", "chapter": "...", "page": 42, "score": 0.8}]
  }]
}
```

Validation uses **semantic similarity** (embedding-based) rather than keyword matching. Each check question is embedded and compared against session text chunks using cosine similarity. Thresholds: ≥55% pass, 40-55% warning, <40% fail.

### Soccer Diagrams Server

| Tool | Parameters | Returns |
|------|------------|---------|
| `render_tactical_diagram` | `drill` (DrillDefinition object), `format` (png/pdf) | Path to saved image |
| `evaluate_session_plan` | `pitch_length`, `pitch_width`, `num_players`, `activities[]` | Spatial metrics and recommendations |
| `compile_to_pdf` | `title`, `sections[]` ({type, content, caption}), `output_path` | Path to saved PDF |

**DrillDefinition schema:**

```json
{
  "meta": { "title": "Exercise Name", "pitch_length_m": 105, "pitch_width_m": 68 },
  "elements": [
    { "id": "gk1", "type": "player", "x": 52, "y": 34, "label": "GK", "color": "#FFD700" }
  ],
  "actions": [
    { "type": "pass", "from_id": "gk1", "to_id": "p1", "color": "#FFFFFF", "label": "Distribution" }
  ],
  "zones": []
}
```

Action types: `pass`, `run`, `dribble`, `shot`, `curved_run`.

**Area-per-player thresholds** for `evaluate_session_plan`:

| Range | Category | Typical Use |
|-------|----------|-------------|
| < 20 m² | Very tight | 1v1 technique |
| 20–50 m² | Possession | Rondos, small-sided |
| 50–100 m² | Game-like | Small-sided games |
| 100–200 m² | Transitions | Counter-attacks |
| > 200 m² | Fitness | Open running |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile the MCP server TypeScript |
| `npm run build-index -- --skill <name>` | Ingest resources and build vector index for a skill |
| `npm run analyze-resources -- --skill <name>` | Generate a skill proposal from indexed resources |
| `npm run start-server` | Start the coaching-skills MCP server manually |

## Project Conventions

- **Skill definitions** (`skills/**/*.json`) are gitignored because they contain descriptions derived from copyrighted source materials. Skills can be organized in subdirectories.
- **Drafts** (`drafts/`) contains skill proposals and draft definitions during the assisted creation workflow. Contents are gitignored.
- **Templates** (`templates/`) contains reusable output templates. These are version-controlled and available as starting points for reports and improvement plans.
- **Resources** (`resources/`), **samples** (`samples/`), and **output** (`output/`) folders are tracked as empty directories via `.gitkeep` files; their contents are gitignored.
- **Vector indices** (`data/`) are gitignored and reproducible via `npm run build-index`.
- The MCP server discovers skills dynamically at startup — no code changes needed to add or remove skills.

## License

[MIT](LICENSE)
