export type SkillEvaluationResult = {
  source: {
    repository: string;
    commit: string;
    path: string;
    contentHash: string;
  };
  evaluator: {
    repository: string;
    release: string;
    commit: string;
    agent: string;
    agentModel: string;
    judgeProvider: string;
    judgeModel: string;
    environment: string;
    attempts: number;
  };
  metrics: {
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
  completedAt: number;
};

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

function formatLabel(value: string) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function formatProvider(provider: string) {
  return provider.toLowerCase() === "openai" ? "OpenAI" : formatLabel(provider);
}

export function SkillEvaluationReport({ result }: { result: SkillEvaluationResult }) {
  const { evaluator, metrics, source } = result;
  const sourceCommitHref = `https://github.com/${source.repository}/commit/${source.commit}`;

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
      </header>

      <section className="skill-evaluation-overview" aria-labelledby="skill-evaluation-overview">
        <h3 id="skill-evaluation-overview">Overview</h3>
        <dl className="skill-evaluation-overview-list">
          <div>
            <dt>Agent</dt>
            <dd>
              {formatAgent(evaluator.agent)} ({evaluator.agentModel})
            </dd>
          </div>
          <div>
            <dt>Judge</dt>
            <dd>
              {formatProvider(evaluator.judgeProvider)} ({evaluator.judgeModel})
            </dd>
          </div>
          <div>
            <dt>Num attempts</dt>
            <dd>{evaluator.attempts} per case</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              <a href={sourceCommitHref} target="_blank" rel="noreferrer">
                {source.repository}@{source.commit.slice(0, 7)}
              </a>
            </dd>
          </div>
        </dl>
      </section>

      <section className="skill-evaluation-metrics" aria-labelledby="skill-evaluation-results">
        <div className="skill-evaluation-section-heading">
          <h3 id="skill-evaluation-results">Results</h3>
          <p>
            Scores show skill-assisted performance. Lift is measured against the no-skill baseline.
          </p>
        </div>
        <div className="skill-evaluation-table-wrap">
          <table className="skill-evaluation-table">
            <caption className="sr-only">Results reported by SkillEvaluator</caption>
            <thead>
              <tr>
                <th scope="col">Dimension</th>
                <th scope="col">Num</th>
                <th scope="col">With skill</th>
                <th scope="col">Baseline</th>
                <th scope="col">Lift</th>
              </tr>
            </thead>
            <tbody>
              {metrics.dimensions.map((dimension) => (
                <tr key={dimension.id}>
                  <th scope="row">{formatLabel(dimension.id)}</th>
                  <td>{metrics.sampleCount}</td>
                  <td>{formatPercent(dimension.withSkill)}</td>
                  <td>{formatPercent(dimension.withoutSkill)}</td>
                  <td className={dimension.delta > 0 ? "is-positive" : undefined}>
                    {formatPoints(dimension.delta)}
                  </td>
                </tr>
              ))}
              <tr>
                <th scope="row">Overall score</th>
                <td>{metrics.sampleCount}</td>
                <td>{formatPercent(metrics.overall.withSkill)}</td>
                <td>{formatPercent(metrics.overall.withoutSkill)}</td>
                <td className={metrics.overall.delta > 0 ? "is-positive" : undefined}>
                  {formatPoints(metrics.overall.delta)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
