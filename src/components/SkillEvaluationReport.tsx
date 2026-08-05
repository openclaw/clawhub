import { Ban, CircleCheck, CircleX, Clock3 } from "lucide-react";

export type SkillEvaluationRunRecord = {
  schemaVersion: 1;
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
    model: string;
    provider: string;
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

function shortCommit(commit: string) {
  return commit.slice(0, 12);
}

function formatTimestamp(value: string | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatPoints(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pts`;
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
          <p className="skill-evaluation-eyebrow">NVIDIA SkillEvaluator · Tier 3</p>
          <h2>Live agent evaluation</h2>
          <p>
            Metrics come directly from SkillEvaluator&apos;s native result.json for the exact synced
            source version. ClawHub does not recalculate or reinterpret its scores.
          </p>
        </div>
        <div className={`skill-evaluation-state is-${record.state}`} role="status">
          <StateIcon size={16} aria-hidden="true" />
          <span>{presentation.label}</span>
        </div>
      </header>

      {record.smokeRun ? (
        <div className="skill-evaluation-smoke-note">
          <strong>One-attempt smoke run</strong>
          <span>This proves the integration path; it is not a quality verdict.</span>
        </div>
      ) : null}

      {record.reason ? (
        <div className={`skill-evaluation-message is-${record.state}`}>
          <strong>{record.reason.code}</strong>
          <span>{record.reason.message}</span>
        </div>
      ) : null}

      <dl className="skill-evaluation-provenance">
        <div>
          <dt>Source</dt>
          <dd>
            {record.source.repository} · {record.source.path}
          </dd>
        </div>
        <div>
          <dt>Evaluated source commit</dt>
          <dd title={record.source.commit}>{shortCommit(record.source.commit)}</dd>
        </div>
        <div>
          <dt>Eval dataset</dt>
          <dd>{record.evals.dataset ?? record.evals.directory}</dd>
        </div>
        <div>
          <dt>Eval config</dt>
          <dd>{record.evals.config ?? "CLI and evaluator defaults"}</dd>
        </div>
        <div>
          <dt>Evaluator</dt>
          <dd>
            {record.evaluator.version} · {shortCommit(record.evaluator.commit)}
          </dd>
        </div>
        <div>
          <dt>Agent model</dt>
          <dd>{record.evaluator.model}</dd>
        </div>
        <div>
          <dt>Run</dt>
          <dd>
            {record.evaluator.agent} · {record.evaluator.environment} · {record.evaluator.attempts}{" "}
            attempt
          </dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{formatTimestamp(record.timing.startedAt)}</dd>
        </div>
        <div>
          <dt>Finished</dt>
          <dd>{formatTimestamp(record.timing.finishedAt)}</dd>
        </div>
      </dl>

      {record.state === "completed" && metrics ? (
        <section className="skill-evaluation-metrics" aria-label="SkillEvaluator metrics">
          <dl className="skill-evaluation-summary">
            <div>
              <dt>Overall score</dt>
              <dd>{formatPercent(metrics.overall.withSkill)}</dd>
              <span>With skill</span>
            </div>
            <div>
              <dt>Baseline score</dt>
              <dd>{formatPercent(metrics.overall.withoutSkill)}</dd>
              <span>Without skill</span>
            </div>
            <div>
              <dt>Skill lift</dt>
              <dd>{formatPoints(metrics.overall.delta)}</dd>
              <span>With skill minus baseline</span>
            </div>
            <div>
              <dt>Cases passed</dt>
              <dd>
                {metrics.passRate.withSkill.passed} / {metrics.passRate.withSkill.total}
              </dd>
              <span>
                Baseline {metrics.passRate.withoutSkill.passed} /{" "}
                {metrics.passRate.withoutSkill.total}
              </span>
            </div>
          </dl>

          <div className="skill-evaluation-table-wrap">
            <table className="skill-evaluation-table">
              <caption>Metric scores reported by SkillEvaluator</caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">With skill</th>
                  <th scope="col">Baseline</th>
                  <th scope="col">Lift</th>
                </tr>
              </thead>
              <tbody>
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

      {record.state === "completed" && record.artifacts ? (
        <section className="skill-evaluation-artifacts" aria-label="SkillEvaluator artifacts">
          <div className="skill-evaluation-artifact-links">
            <a href={record.artifacts.resultUrl} target="_blank" rel="noreferrer">
              result.json
            </a>
            <a href={record.artifacts.runConfigUrl} target="_blank" rel="noreferrer">
              run_config.json
            </a>
          </div>
        </section>
      ) : null}
    </div>
  );
}
