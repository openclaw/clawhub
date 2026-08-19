export type SkillEvaluationMetrics = {
  sampleCount: number;
  overall: {
    withSkill: number;
    withoutSkill: number;
    delta: number;
  };
  cases: {
    withSkillPassed: number;
    withSkillTotal: number;
    withoutSkillPassed: number;
    withoutSkillTotal: number;
  };
  dimensions: Array<{
    id: string;
    withSkill: number;
    withoutSkill: number;
    delta: number;
  }>;
};

const DIMENSION_ORDER = [
  "security",
  "correctness",
  "discoverability",
  "effectiveness",
  "efficiency",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readRecord(record: Record<string, unknown>, key: string) {
  const value = asRecord(record[key]);
  if (!value) throw new Error(`SkillEvaluator result.json is missing ${key}`);
  return value;
}

function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`SkillEvaluator result.json has an invalid ${key} value`);
  }
  return value;
}

function scoreDelta(withSkill: number, withoutSkill: number) {
  return Math.round((withSkill - withoutSkill) * 10_000) / 10_000;
}

function readDimensions(agent: Record<string, unknown>) {
  const withSkill = readRecord(agent, "dimensions_with_skill");
  const withoutSkill = readRecord(agent, "dimensions_without_skill");
  const ids = [...new Set([...Object.keys(withSkill), ...Object.keys(withoutSkill)])];
  const orderedIds = [
    ...DIMENSION_ORDER.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !DIMENSION_ORDER.includes(id as (typeof DIMENSION_ORDER)[number])).sort(),
  ];
  return orderedIds.map((id) => {
    const withSkillDimension = readRecord(withSkill, id);
    const withoutSkillDimension = readRecord(withoutSkill, id);
    const withSkillScore = readNumber(withSkillDimension, "score");
    const withoutSkillScore = readNumber(withoutSkillDimension, "score");
    return {
      id,
      withSkill: withSkillScore,
      withoutSkill: withoutSkillScore,
      delta: scoreDelta(withSkillScore, withoutSkillScore),
    };
  });
}

export function parseSkillEvaluatorResultJson(
  resultJson: string,
  agentName: string,
): { metrics: SkillEvaluationMetrics; runId?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson) as unknown;
  } catch {
    throw new Error("SkillEvaluator result.json is not valid JSON");
  }
  const root = asRecord(parsed);
  if (!root || !Array.isArray(root.metrics) || !asRecord(root.agents)) {
    throw new Error("SkillEvaluator result.json is missing its metric summary");
  }
  if (root.execution_status !== "succeeded") {
    throw new Error("SkillEvaluator result.json does not contain a successful evaluation");
  }
  const agents = readRecord(root, "agents");
  const agent = readRecord(agents, agentName);
  if (agent.execution_status !== "succeeded") {
    throw new Error(`SkillEvaluator result.json does not contain a successful ${agentName} run`);
  }
  const lift = readRecord(agent, "lift");
  const overall = readRecord(lift, "overall");
  const passAtK = readRecord(agent, "pass_at_k");
  const withSkill = readRecord(passAtK, "with_skill");
  const withoutSkill = readRecord(passAtK, "without_skill");
  const runId = typeof root.run_id === "string" && root.run_id.trim() ? root.run_id : undefined;

  return {
    metrics: {
      sampleCount: readNumber(withSkill, "attempts_used"),
      overall: {
        withSkill: readNumber(overall, "with_skill"),
        withoutSkill: readNumber(overall, "without_skill"),
        delta: readNumber(overall, "delta"),
      },
      cases: {
        withSkillPassed: readNumber(withSkill, "passed_cases"),
        withSkillTotal: readNumber(withSkill, "total_cases"),
        withoutSkillPassed: readNumber(withoutSkill, "passed_cases"),
        withoutSkillTotal: readNumber(withoutSkill, "total_cases"),
      },
      dimensions: readDimensions(agent),
    },
    ...(runId ? { runId } : {}),
  };
}
