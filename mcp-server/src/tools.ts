import { SkillIndex, SearchResult } from "./vectordb";

export interface Principle {
  name: string;
  description: string;
  checks: string[];
}

export interface SkillDefinition {
  name: string;
  displayName: string;
  author: string;
  authorDescription: string;
  domain: string;
  toolPrefix: string;
  sourceDescription: string;
  principles: Principle[];
  /** Optional: use a shared vector index instead of skill-specific one */
  sharedIndex?: string;
}

export interface ValidationResult {
  overall: string;
  principles: Array<{
    name: string;
    status: "pass" | "warning" | "fail";
    findings: string;
    suggestions: string[];
    relevantPassages: SearchResult[];
  }>;
}

export function listPrinciples(skill: SkillDefinition): Principle[] {
  return skill.principles;
}

export async function searchSkill(
  index: SkillIndex,
  query: string,
  topK = 5
): Promise<SearchResult[]> {
  return index.search(query, topK);
}

export async function validateSession(
  index: SkillIndex,
  skill: SkillDefinition,
  sessionPlanText: string
): Promise<ValidationResult> {
  const results = [];

  for (const principle of skill.principles) {
    // Search for relevant passages for each principle
    const passages = await index.search(
      `${principle.name} ${principle.description}`,
      3
    );

    // Build analysis context
    const checkResults = principle.checks.map((check) => {
      const planLower = sessionPlanText.toLowerCase();
      // Simple heuristic matching — the real intelligence comes from Claude using this data
      const hasRelevantContent =
        planLower.includes(principle.name.toLowerCase()) ||
        principle.checks.some((c) =>
          c
            .toLowerCase()
            .split(" ")
            .some(
              (word) => word.length > 5 && planLower.includes(word.toLowerCase())
            )
        );
      return { check, present: hasRelevantContent };
    });

    const passCount = checkResults.filter((c) => c.present).length;
    const status: "pass" | "warning" | "fail" =
      passCount >= 2 ? "pass" : passCount >= 1 ? "warning" : "fail";

    const suggestions = checkResults
      .filter((c) => !c.present)
      .map((c) => c.check);

    results.push({
      name: principle.name,
      status,
      findings: `${passCount}/${principle.checks.length} checks addressed`,
      suggestions,
      relevantPassages: passages,
    });
  }

  const failCount = results.filter((r) => r.status === "fail").length;
  const overall =
    failCount === 0
      ? `Session plan aligns well with ${skill.displayName}`
      : `${failCount} principle(s) need attention`;

  return { overall, principles: results };
}
