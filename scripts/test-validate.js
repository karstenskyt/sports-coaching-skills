const { SkillIndex } = require('../mcp-server/dist/vectordb');
const { validateSession, searchSkill, listPrinciples } = require('../mcp-server/dist/tools');
const fs = require('fs');
const path = require('path');

const skillName = process.argv[2];
if (!skillName) {
  console.error("Usage: node scripts/test-validate.js <skill-name>");
  console.error("Example: node scripts/test-validate.js goalkeeping-coach");
  process.exit(1);
}

// Load skill definition
const skillPath = path.resolve(__dirname, `../skills/${skillName}.json`);
if (!fs.existsSync(skillPath)) {
  console.error(`Skill definition not found: ${skillPath}`);
  process.exit(1);
}
const definition = JSON.parse(fs.readFileSync(skillPath, 'utf-8'));

const samplePlan = `Sample session plan for validation testing.
Setup: Coach plus 2 goalkeepers, rotate between repetitions.
Sequence: Coach serves ball, GK handles, distributes, recovers for next action.
Progressions: Increase pressure, add decision-making.
Coaching Points: Starting position, timing, communication.`;

async function run() {
  const index = new SkillIndex(skillName);

  console.log(`=== VALIDATION: ${definition.displayName} ===\n`);

  console.log("Principles:");
  const principles = listPrinciples(definition);
  for (const p of principles) {
    console.log(`  - ${p.name}: ${p.checks.length} checks`);
  }
  console.log();

  const result = await validateSession(index, definition, samplePlan);
  console.log("Overall:", result.overall, "\n");

  for (const p of result.principles) {
    const icon = p.status === "pass" ? "PASS" : p.status === "warning" ? "WARN" : "FAIL";
    console.log(`[${icon}] ${p.name} - ${p.findings}`);
    if (p.suggestions.length > 0) {
      for (const s of p.suggestions) {
        console.log(`  -> Suggestion: ${s}`);
      }
    }
    if (p.relevantPassages.length > 0) {
      console.log(`  Reference (p.${p.relevantPassages[0].page}): "${p.relevantPassages[0].text.substring(0, 150)}..."`);
    }
    console.log();
  }

  console.log("=== SEMANTIC SEARCH: coaching feedback ===\n");
  const passages = await searchSkill(index, "coaching feedback decision making", 2);
  for (const p of passages) {
    console.log(`Score: ${p.score.toFixed(3)} | Page: ${p.page} | Chapter: ${p.chapter}`);
    console.log(`"${p.text.substring(0, 200)}..."\n`);
  }
}

run().catch(console.error);
