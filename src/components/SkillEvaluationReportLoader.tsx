import { useEffect, useState } from "react";
import {
  SkillEvaluationReport,
  type SkillEvaluationMetrics,
  type SkillEvaluationRunRecord,
} from "./SkillEvaluationReport";

type LocalSkillEvaluationSource = {
  repository: string;
  commit: string;
  path: string;
};

const LOCAL_EVALUATION_INDEX_URL = "/__skill-evaluator-demo/index.json";
export const PENDING_EVALUATION_POLL_INTERVAL_MS = 5_000;

function safePathSegments(path: string) {
  if (!path || path.startsWith("/") || path.endsWith("/")) return null;
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return segments;
}

export function buildLocalSkillEvaluationManifestUrl(
  source: LocalSkillEvaluationSource,
  contentHash: string,
) {
  if (source.repository.toLowerCase() !== "nvidia/skills") return null;
  if (!/^[a-f0-9]{40}$/i.test(source.commit)) return null;
  if (!/^[a-f0-9]{64}$/i.test(contentHash)) return null;
  const pathSegments = safePathSegments(source.path);
  if (!pathSegments) return null;
  const segments = [
    "__skill-evaluator-demo",
    "nvidia",
    "skills",
    contentHash.toLowerCase(),
    ...pathSegments,
    "evaluation.json",
  ];
  return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function resolveIndexedContentHash(value: unknown, source: LocalSkillEvaluationSource) {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.evaluations)) {
    throw new Error("Unsupported evaluation index");
  }
  const entry = value.evaluations.find(
    (candidate) =>
      isRecord(candidate) &&
      candidate.repository === source.repository &&
      candidate.commit === source.commit &&
      candidate.path === source.path,
  );
  if (!isRecord(entry) || typeof entry.contentHash !== "string") return null;
  return entry.contentHash;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`SkillEvaluator result.json has an invalid ${key} value`);
  }
  return value;
}

function readRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`SkillEvaluator result.json is missing ${key}`);
  return value;
}

function metricLabel(metric: string) {
  const label = metric.replaceAll("_", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function parseSkillEvaluatorMetrics(value: unknown, agentName: string): SkillEvaluationMetrics {
  if (!isRecord(value) || !Array.isArray(value.metrics) || !isRecord(value.agents)) {
    throw new Error("SkillEvaluator result.json is missing its metric summary");
  }
  const metricNames = value.metrics.filter(
    (metric): metric is string => typeof metric === "string" && metric.length > 0,
  );
  if (metricNames.length === 0 || metricNames.length !== value.metrics.length) {
    throw new Error("SkillEvaluator result.json has an invalid metric list");
  }

  const agent = readRecord(value.agents, agentName);
  const withSkill = readRecord(agent, "with_skill");
  const withoutSkill = readRecord(agent, "without_skill");
  const lift = readRecord(agent, "lift");
  const overall = readRecord(lift, "overall");
  const passAtK = readRecord(agent, "pass_at_k");
  const passWithSkill = readRecord(passAtK, "with_skill");
  const passWithoutSkill = readRecord(passAtK, "without_skill");

  return {
    agent: agentName,
    overall: {
      withSkill: readNumber(overall, "with_skill"),
      withoutSkill: readNumber(overall, "without_skill"),
      delta: readNumber(overall, "delta"),
    },
    passRate: {
      withSkill: {
        passed: readNumber(passWithSkill, "passed_cases"),
        total: readNumber(passWithSkill, "total_cases"),
        rate: readNumber(passWithSkill, "rate"),
      },
      withoutSkill: {
        passed: readNumber(passWithoutSkill, "passed_cases"),
        total: readNumber(passWithoutSkill, "total_cases"),
        rate: readNumber(passWithoutSkill, "rate"),
      },
    },
    metrics: metricNames.map((metric) => {
      const metricLift = readRecord(lift, metric);
      return {
        name: metricLabel(metric),
        withSkill: readNumber(withSkill, metric),
        withoutSkill: readNumber(withoutSkill, metric),
        delta: readNumber(metricLift, "delta"),
      };
    }),
  };
}

function validateRecord(
  value: unknown,
  source: LocalSkillEvaluationSource,
  contentHash: string,
  manifestUrl: string,
): SkillEvaluationRunRecord {
  if (!isRecord(value) || value.schemaVersion !== 2) {
    throw new Error("Unsupported evaluation record");
  }
  if (!new Set(["pending", "skipped", "failed", "completed"]).has(String(value.state))) {
    throw new Error("Invalid evaluation state");
  }
  if (!isRecord(value.source)) throw new Error("Missing evaluation source provenance");
  if (
    value.source.repository !== source.repository ||
    value.source.contentHash !== contentHash ||
    value.source.path !== source.path
  ) {
    throw new Error("Evaluation record does not match this source version");
  }
  if (!isRecord(value.evals) || !isRecord(value.evaluator) || !isRecord(value.timing)) {
    throw new Error("Incomplete evaluation provenance");
  }
  if (value.artifacts !== undefined) {
    if (!isRecord(value.artifacts)) throw new Error("Invalid evaluation artifacts");
    const artifactPrefix = manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1);
    for (const key of ["reportUrl", "resultUrl", "runConfigUrl"] as const) {
      const url = value.artifacts[key];
      if (typeof url !== "string" || !url.startsWith(artifactPrefix) || url.includes("..")) {
        throw new Error("Evaluation artifact URL escaped its source-version directory");
      }
    }
  }
  return value as unknown as SkillEvaluationRunRecord;
}

type LoadState =
  | { status: "loading" }
  | { status: "absent" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      record: SkillEvaluationRunRecord;
      metrics?: SkillEvaluationMetrics;
      metricsError?: string;
    };

export function SkillEvaluationReportLoader({
  source,
  fetchImpl = fetch,
}: {
  source: LocalSkillEvaluationSource;
  fetchImpl?: typeof fetch;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!buildLocalSkillEvaluationManifestUrl(source, "a".repeat(64))) {
      setState({ status: "error", message: "This source is not eligible for the local demo." });
      return undefined;
    }

    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    setState({ status: "loading" });
    const load = async () => {
      try {
        const indexResponse = await fetchImpl(LOCAL_EVALUATION_INDEX_URL, {
          signal: controller.signal,
        });
        if (indexResponse.status === 404) {
          if (!controller.signal.aborted) setState({ status: "absent" });
          return;
        }
        if (!indexResponse.ok) {
          throw new Error(`Evaluation index request failed (${indexResponse.status})`);
        }
        const contentHash = resolveIndexedContentHash(await indexResponse.json(), source);
        if (controller.signal.aborted) return;
        if (!contentHash) {
          setState({ status: "absent" });
          return;
        }
        const manifestUrl = buildLocalSkillEvaluationManifestUrl(source, contentHash);
        if (!manifestUrl) throw new Error("Evaluation index contained an invalid content hash");
        const response = await fetchImpl(manifestUrl, { signal: controller.signal });
        if (response.status === 404) {
          if (!controller.signal.aborted) setState({ status: "absent" });
          return;
        }
        if (!response.ok)
          throw new Error(`Evaluation artifact request failed (${response.status})`);
        const value: unknown = await response.json();
        const record = validateRecord(value, source, contentHash, manifestUrl);
        if (controller.signal.aborted) return;
        setState({ status: "ready", record });
        if (record.state === "pending") {
          pollTimer = setTimeout(() => void load(), PENDING_EVALUATION_POLL_INTERVAL_MS);
        }
        if (record.state === "completed" && record.artifacts) {
          try {
            const resultResponse = await fetchImpl(record.artifacts.resultUrl, {
              signal: controller.signal,
            });
            if (!resultResponse.ok) {
              throw new Error(`SkillEvaluator result request failed (${resultResponse.status})`);
            }
            const metrics = parseSkillEvaluatorMetrics(
              await resultResponse.json(),
              record.evaluator.agent,
            );
            if (controller.signal.aborted) return;
            setState({ status: "ready", record, metrics });
          } catch (error: unknown) {
            if (controller.signal.aborted) return;
            const metricsError =
              error instanceof Error ? error.message : "Unable to read SkillEvaluator result.json";
            setState({ status: "ready", record, metricsError });
          }
        }
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to load evaluation artifact",
        });
      }
    };
    void load();

    return () => {
      controller.abort();
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [fetchImpl, source.commit, source.path, source.repository]);

  if (state.status === "loading") {
    return (
      <div className="skill-evaluation-loading" role="status">
        Loading evaluation…
      </div>
    );
  }
  if (state.status === "absent") {
    return (
      <div className="skill-evaluation-empty">
        <h2>No evaluation recorded for this version</h2>
        <p>The local NVIDIA demo has not produced an artifact for this exact source commit.</p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="skill-evaluation-empty is-error" role="alert">
        <h2>Evaluation report unavailable</h2>
        <p>{state.message}</p>
      </div>
    );
  }
  return (
    <SkillEvaluationReport
      record={state.record}
      metrics={state.metrics}
      metricsError={state.metricsError}
    />
  );
}
