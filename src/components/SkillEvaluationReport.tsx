import { Ban, CircleCheck, CircleX, Clock3 } from "lucide-react";

export type SkillEvaluationRunRecord = {
  schemaVersion: 2;
  state: "pending" | "skipped" | "failed" | "completed";
  smokeRun: boolean;
  source: {
    repository: string;
    commit: string;
    path: string;
    contentHash: string;
    upstreamVersion: string | null;
  };
  evals: {
    directory: string;
    taskSource: "evals_json" | "native_harbor" | null;
    dataset: string | null;
    config: string | null;
  };
  evaluator: {
    repository: "NVIDIA/SkillEvaluator";
    commit: string;
    version: string;
    agent: string;
    agentModel: string;
    judgeModel: string;
    judgeProvider: string;
    environment: string;
    attempts: number;
  };
  timing: {
    startedAt: string;
    finishedAt?: string;
  };
  reason?: {
    code: string;
    message: string;
  };
  artifacts?: {
    reportUrl: string;
    resultUrl: string;
    runConfigUrl: string;
  };
};

export type SkillEvaluationMetrics = {
  agent: string;
  overall: {
    withSkill: number;
    withoutSkill: number;
    delta: number;
  };
  passRate: {
    withSkill: { passed: number; total: number; rate: number };
    withoutSkill: { passed: number; total: number; rate: number };
  };
  metrics: Array<{
    name: string;
    withSkill: number;
    withoutSkill: number;
    delta: number;
  }>;
};

const STATE_PRESENTATION = {
  pending: { label: "Evaluation in progress", icon: Clock3 },
  skipped: { label: "Evaluation skipped", icon: Ban },
  failed: { label: "Evaluation failed", icon: CircleX },
  completed: { label: "Evaluation completed", icon: CircleCheck },
} as const;

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatPoints(value: number) {
  return `${value >= 0 ? "+" : ""}${Math.round(value * 100)} pts`;
}

function formatAgent(agent: string) {
  const labels: Record<string, string> = {
    "claude-code": "Claude Code",
    codex: "Codex",
    opencode: "OpenCode",
  };
  return labels[agent] ?? agent;
}

function formatRunDate(record: SkillEvaluationRunRecord) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(record.timing.finishedAt ?? record.timing.startedAt));
}

function formatAttempts(attempts: number) {
  return attempts === 1 ? "Single-run result" : `${attempts} attempts per case`;
}

const REASON_LABELS: Record<string, string> = {
  "ambiguous-evals-config": "Eval configuration is ambiguous",
  "eval-source-config-mismatch": "Eval configuration does not match its files",
  "no-evals": "No evals attached",
  "unsupported-eval-layout": "Eval layout is not supported",
};

function formatCaseDelta(withSkill: number, withoutSkill: number) {
  const delta = withSkill - withoutSkill;
  return `${delta >= 0 ? "+" : ""}${delta} ${Math.abs(delta) === 1 ? "case" : "cases"}`;
}

export function SkillEvaluationReport({
  record,
  metrics,
  metricsError,
}: {
  record: SkillEvaluationRunRecord;
  metrics?: SkillEvaluationMetrics;
  metricsError?: string;
}) {
  const presentation = STATE_PRESENTATION[record.state];
  const StateIcon = presentation.icon;

  return (
    <div className="skill-evaluation-report">
      <header className="skill-evaluation-header">
        <div>
          <h2>Evals</h2>
          <p>
            Evals compare how well an agent completes the same test cases with and without this
            skill.
          </p>
        </div>
        {record.state !== "completed" ? (
          <div className={`skill-evaluation-state is-${record.state}`} role="status">
            <StateIcon size={16} aria-hidden="true" />
            <span>{presentation.label}</span>
          </div>
        ) : null}
      </header>

      {record.reason ? (
        <div className={`skill-evaluation-message is-${record.state}`}>
          <strong>{REASON_LABELS[record.reason.code] ?? record.reason.code}</strong>
          <span>{record.reason.message}</span>
        </div>
      ) : null}

      {record.state === "completed" && metrics ? (
        <section className="skill-evaluation-metrics" aria-label="SkillEvaluator metrics">
          <div className="skill-evaluation-context" aria-label="Evaluation context">
            <strong>{formatAttempts(record.evaluator.attempts)}</strong>
            <span>
              Agent: {formatAgent(record.evaluator.agent)} ({record.evaluator.agentModel})
            </span>
            <span>Judge: {record.evaluator.judgeModel}</span>
            <span>SkillEvaluator {record.evaluator.version}</span>
            <span>Run: {formatRunDate(record)}</span>
          </div>
          <div className="skill-evaluation-table-wrap">
            <table className="skill-evaluation-table">
              <caption>
                Results reported by{" "}
                <a href="https://github.com/NVIDIA/SkillEvaluator" target="_blank" rel="noreferrer">
                  SkillEvaluator
                </a>
              </caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">With skill</th>
                  <th scope="col">Baseline</th>
                  <th scope="col">Lift</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Overall score</th>
                  <td>{formatPercent(metrics.overall.withSkill)}</td>
                  <td>{formatPercent(metrics.overall.withoutSkill)}</td>
                  <td className={metrics.overall.delta > 0 ? "is-positive" : undefined}>
                    {formatPoints(metrics.overall.delta)}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Cases passed</th>
                  <td>
                    {metrics.passRate.withSkill.passed} / {metrics.passRate.withSkill.total}
                  </td>
                  <td>
                    {metrics.passRate.withoutSkill.passed} / {metrics.passRate.withoutSkill.total}
                  </td>
                  <td
                    className={
                      metrics.passRate.withSkill.passed > metrics.passRate.withoutSkill.passed
                        ? "is-positive"
                        : undefined
                    }
                  >
                    {formatCaseDelta(
                      metrics.passRate.withSkill.passed,
                      metrics.passRate.withoutSkill.passed,
                    )}
                  </td>
                </tr>
                {metrics.metrics.map((metric) => (
                  <tr key={metric.name}>
                    <th scope="row">{metric.name}</th>
                    <td>{formatPercent(metric.withSkill)}</td>
                    <td>{formatPercent(metric.withoutSkill)}</td>
                    <td className={metric.delta > 0 ? "is-positive" : undefined}>
                      {formatPoints(metric.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {record.state === "completed" && metricsError ? (
        <div className="skill-evaluation-message" role="note">
          <strong>Metrics unavailable</strong>
          <span>{metricsError}</span>
        </div>
      ) : null}
    </div>
  );
}
