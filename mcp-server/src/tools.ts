import {
  SkillIndex,
  SearchResult,
  splitIntoChunks,
  findSimilarChunks,
} from "./vectordb";

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

/** Evidence for a single check question */
export interface CheckEvidence {
  question: string;
  score: number;
  status: "pass" | "warning" | "fail";
  evidence: string[];
}

/** Result for a single principle */
export interface PrincipleResult {
  name: string;
  description: string;
  status: "pass" | "warning" | "fail";
  confidence: number;
  findings: string;
  checks: CheckEvidence[];
  suggestions: string[];
  relevantPassages: SearchResult[];
}

export interface ValidationResult {
  overall: string;
  summary: {
    pass: number;
    warning: number;
    fail: number;
    averageConfidence: number;
  };
  principles: PrincipleResult[];
}

// Semantic similarity thresholds (tuned for MiniLM-L6-v2)
const THRESHOLDS = {
  PASS: 0.55, // High confidence the check is addressed
  WARNING: 0.40, // Some relevant content but uncertain
};

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
  // Split session into semantic chunks for analysis
  const sessionChunks = splitIntoChunks(sessionPlanText);
  const results: PrincipleResult[] = [];

  for (const principle of skill.principles) {
    // Search for relevant passages from source material
    const passages = await index.search(
      `${principle.name} ${principle.description}`,
      3
    );

    // Evaluate each check using semantic similarity
    const checkResults: CheckEvidence[] = [];

    for (const check of principle.checks) {
      // Find most similar chunks to this check question
      const similarChunks = await findSimilarChunks(sessionChunks, check, 3);
      const topScore = similarChunks.length > 0 ? similarChunks[0].score : 0;

      // Determine status based on similarity threshold
      let status: "pass" | "warning" | "fail";
      if (topScore >= THRESHOLDS.PASS) {
        status = "pass";
      } else if (topScore >= THRESHOLDS.WARNING) {
        status = "warning";
      } else {
        status = "fail";
      }

      // Extract evidence excerpts (truncate for readability)
      const evidence = similarChunks
        .filter((c) => c.score >= THRESHOLDS.WARNING)
        .map((c) => c.text.length > 200 ? c.text.substring(0, 200) + "..." : c.text);

      checkResults.push({
        question: check,
        score: Math.round(topScore * 100) / 100,
        status,
        evidence,
      });
    }

    // Aggregate principle status from check results
    const passCount = checkResults.filter((c) => c.status === "pass").length;
    const warnCount = checkResults.filter((c) => c.status === "warning").length;
    const failCount = checkResults.filter((c) => c.status === "fail").length;

    // Principle passes if majority of checks pass, fails if majority fail
    let principleStatus: "pass" | "warning" | "fail";
    if (passCount >= Math.ceil(principle.checks.length / 2)) {
      principleStatus = "pass";
    } else if (failCount >= Math.ceil(principle.checks.length / 2)) {
      principleStatus = "fail";
    } else {
      principleStatus = "warning";
    }

    // Calculate confidence as average of check scores
    const avgScore =
      checkResults.reduce((sum, c) => sum + c.score, 0) / checkResults.length;

    // Build suggestions from failed/warning checks
    const suggestions = checkResults
      .filter((c) => c.status === "fail" || c.status === "warning")
      .map((c) => {
        const prefix = c.status === "fail" ? "Missing: " : "Strengthen: ";
        return prefix + c.question;
      });

    results.push({
      name: principle.name,
      description: principle.description,
      status: principleStatus,
      confidence: Math.round(avgScore * 100) / 100,
      findings: `${passCount} pass, ${warnCount} warn, ${failCount} fail (confidence: ${Math.round(avgScore * 100)}%)`,
      checks: checkResults,
      suggestions,
      relevantPassages: passages,
    });
  }

  // Build summary
  const summary = {
    pass: results.filter((r) => r.status === "pass").length,
    warning: results.filter((r) => r.status === "warning").length,
    fail: results.filter((r) => r.status === "fail").length,
    averageConfidence:
      Math.round(
        (results.reduce((sum, r) => sum + r.confidence, 0) / results.length) *
          100
      ) / 100,
  };

  const overall =
    summary.fail === 0
      ? `Session aligns well with ${skill.displayName} (${Math.round(summary.averageConfidence * 100)}% avg confidence)`
      : `${summary.fail} principle(s) need attention (${Math.round(summary.averageConfidence * 100)}% avg confidence)`;

  return { overall, summary, principles: results };
}
