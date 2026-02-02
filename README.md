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
├── resources/           # Source PDFs and transcripts (gitignored)
├── data/                # Vector indices (gitignored)
├── samples/             # Sample session plans and transcripts
└── output/              # Generated diagrams and PDFs
```

**Two MCP servers** run simultaneously:

| Server | Language | Purpose |
|--------|----------|---------|
| `coaching-skills` | Node.js / TypeScript | Semantic search, principle listing, session validation |
| `soccer-diagrams` | Python | Tactical diagrams, spatial evaluation, PDF compilation |

The coaching-skills server dynamically discovers all skill definitions in `skills/` at startup and registers three tools per skill.

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

Create `skills/goalkeeping-coach.json`:

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
| `name` | Kebab-case identifier, must match the `resources/` and `data/` folder name |
| `displayName` | Human-readable name shown in tool descriptions |
| `author` | Author of the source materials |
| `authorDescription` | Short bio for context |
| `domain` | Topic area (e.g. `sport-psychology`, `coaching-pedagogy`) |
| `toolPrefix` | Short prefix for generated MCP tool names |
| `sourceDescription` | Describes what the semantic search covers |
| `principles` | Array of 3-5 principles, each with `name`, `description`, and 3 `checks` |

Each check is a yes/no question used during validation. The validator searches the session plan text for keywords from each check and queries the vector index for supporting evidence.

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

## MCP Tools Reference

### Coaching Skills Server

Generated dynamically per skill. For a skill with `toolPrefix: "example"`:

| Tool | Parameters | Returns |
|------|------------|---------|
| `search_example` | `query` (string), `top_k` (number, default 5) | Array of `{text, chapter, page, score}` |
| `list_example_principles` | none | Array of `{name, description, checks}` |
| `validate_example_session` | `session_plan` (string) | `{overall, principles: [{name, status, findings, suggestions, relevantPassages}]}` |

Validation statuses: `pass`, `warning`, `fail`.

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
| `npm run start-server` | Start the coaching-skills MCP server manually |
| `node scripts/test-validate.js <name>` | Run a quick validation test against a skill |

## Project Conventions

- **Skill definitions** (`skills/*.json`) are gitignored because they contain descriptions derived from copyrighted source materials.
- **Resources** (`resources/`), **samples** (`samples/`), and **output** (`output/`) folders are tracked as empty directories via `.gitkeep` files; their contents are gitignored.
- **Vector indices** (`data/`) are gitignored and reproducible via `npm run build-index`.
- The MCP server discovers skills dynamically at startup — no code changes needed to add or remove skills.

## License

[MIT](LICENSE)
