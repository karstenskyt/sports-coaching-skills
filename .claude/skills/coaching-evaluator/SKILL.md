# Soccer Coaching Evaluator

## Description
Validates and evaluates soccer session plans and training transcripts against configurable coaching frameworks, backed by semantic search over source materials. Can also render tactical diagrams and compile full evaluation PDFs.

Skills are defined as JSON files in `skills/` and discovered dynamically at startup. Each skill defines an author, a set of principles with validation checks, and is backed by a pre-built vector index in `data/`.

## Trigger
- "validate session", "evaluate session", "coaching principles", "session plan"
- Any request to review, validate, or evaluate a soccer training session or transcript

## Tools

### Coaching Skills Server (MCP)
For each loaded skill with tool prefix `<prefix>`:
- `search_<prefix>(query, top_k)` — Semantic search over the skill's source materials
- `list_<prefix>_principles()` — Returns the skill's validation principles
- `validate_<prefix>_session(session_plan)` — Validate a session plan against the skill's principles

### Soccer Diagrams Server (MCP)
- `render_tactical_diagram(drill, format?)` — Render pitch diagram with players, actions, zones
- `evaluate_session_plan(pitch_length, pitch_width, num_players, activities)` — Area-per-player metrics
- `compile_to_pdf(title, sections, output_path?)` — Compile text + images into PDF

## Workflows

### Validating a session plan:
1. Call `validate_<prefix>_session(plan)` for each loaded skill
2. For any warnings/fails, call `search_<prefix>()` with targeted queries for supporting passages
3. Present combined findings across all frameworks

### Evaluating a training transcript:
1. Read and summarize the transcript into activities with coaching cues
2. Run all validators on the summarized session text
3. Cross-reference automated results with actual transcript evidence
4. Note where the heuristic validator may miss nuance — provide manual analysis

### Generating a session plan with diagrams and PDF:
1. Search loaded frameworks for guidance on the topic
2. Design the session addressing all principles
3. Call `render_tactical_diagram()` per activity
4. Call `evaluate_session_plan()` for spatial metrics
5. Run all validators
6. Call `compile_to_pdf()` with markdown sections + image paths

## DrillDefinition Schema

```json
{
  "meta": { "title": "string", "pitch_length_m": 105, "pitch_width_m": 68 },
  "elements": [{ "id": "string", "type": "player|cone", "x": 0, "y": 0, "label": "string", "color": "string" }],
  "actions": [{ "type": "pass|run|dribble|shot|curved_run", "from_id": "string", "to_id": "string", "color": "string", "label": "string" }],
  "zones": []
}
```

## Area-per-Player Thresholds
- <20m² = Very Tight (1v1, technique)
- 20-50m² = Possession (rondos, small-sided)
- 50-100m² = Game-Like (SSGs)
- 100-200m² = Transitions (counter-attacks)
- >200m² = Fitness/Open
