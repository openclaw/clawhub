/* @vitest-environment jsdom */

import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  buildLocalSkillEvaluationManifestUrl,
  PENDING_EVALUATION_POLL_INTERVAL_MS,
  SkillEvaluationReportLoader,
} from "./SkillEvaluationReportLoader";

const source = {
  repository: "nvidia/skills",
  commit: "a".repeat(40),
  path: "skills/doca-dpa",
};
const contentHash = "b".repeat(64);

function pendingRecord(recordSource: typeof source, recordContentHash: string, model: string) {
  return {
    schemaVersion: 1,
    state: "pending",
    smokeRun: true,
    source: {
      ...recordSource,
      contentHash: recordContentHash,
      upstreamVersion: null,
    },
    evals: {
      directory: `${recordSource.path}/evals`,
      taskSource: "evals_json",
      dataset: `${recordSource.path}/evals/evals.json`,
      config: null,
    },
    evaluator: {
      repository: "NVIDIA/SkillEvaluator",
      commit: "d".repeat(40),
      version: "0.1.0",
      agent: "codex",
      model,
      provider: "openai",
      environment: "local",
      attempts: 1,
    },
    timing: { startedAt: "2026-08-04T00:00:00.000Z" },
  };
}

function completedRecord(recordSource: typeof source, recordContentHash: string, model: string) {
  const artifactRoot = `/__skill-evaluator-demo/nvidia/skills/${recordContentHash}/${recordSource.path}`;
  return {
    ...pendingRecord(recordSource, recordContentHash, model),
    state: "completed",
    timing: {
      startedAt: "2026-08-04T00:00:00.000Z",
      finishedAt: "2026-08-04T00:05:00.000Z",
    },
    artifacts: {
      reportUrl: `${artifactRoot}/report.html`,
      resultUrl: `${artifactRoot}/result.json`,
      runConfigUrl: `${artifactRoot}/run_config.json`,
    },
  };
}

describe("local SkillEvaluator report loading", () => {
  it("binds the manifest URL to the exact repository, content hash, and skill path", () => {
    expect(buildLocalSkillEvaluationManifestUrl(source, contentHash)).toBe(
      `/__skill-evaluator-demo/nvidia/skills/${contentHash}/skills/doca-dpa/evaluation.json`,
    );
    expect(
      buildLocalSkillEvaluationManifestUrl(
        { ...source, repository: "community/skills" },
        contentHash,
      ),
    ).toBeNull();
    expect(
      buildLocalSkillEvaluationManifestUrl({ ...source, path: "../doca-dpa" }, contentHash),
    ).toBeNull();
    expect(buildLocalSkillEvaluationManifestUrl(source, "not-a-hash")).toBeNull();
  });

  it("shows a version-specific empty state when no local artifact exists", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));

    render(<SkillEvaluationReportLoader source={source} fetchImpl={fetchImpl} />);

    await waitFor(() => {
      expect(screen.getByText("No evaluation recorded for this version")).toBeTruthy();
    });
  });

  it("reuses an evaluation across repository commits when skill content is identical", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          schemaVersion: 1,
          evaluations: [
            {
              ...source,
              contentHash,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json(pendingRecord(source, contentHash, "gpt-5.4-mini")));

    render(<SkillEvaluationReportLoader source={source} fetchImpl={fetchImpl} />);

    await waitFor(() => {
      expect(screen.getByText("Evaluation in progress")).toBeTruthy();
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/__skill-evaluator-demo/index.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `/__skill-evaluator-demo/nvidia/skills/${contentHash}/skills/doca-dpa/evaluation.json`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("renders key metrics from SkillEvaluator result.json", async () => {
    const index = {
      schemaVersion: 1,
      evaluations: [{ ...source, contentHash }],
    };
    const manifest = completedRecord(source, contentHash, "gpt-5.4-mini");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(index))
      .mockResolvedValueOnce(Response.json(manifest))
      .mockResolvedValueOnce(
        Response.json({
          metrics: ["security", "accuracy"],
          agents: {
            codex: {
              with_skill: { security: 1, accuracy: 0.9 },
              without_skill: { security: 1, accuracy: 0.45 },
              lift: {
                security: { with_skill: 1, without_skill: 1, delta: 0 },
                accuracy: { with_skill: 0.9, without_skill: 0.45, delta: 0.45 },
                overall: { with_skill: 0.9587, without_skill: 0.6058, delta: 0.3529 },
              },
              pass_at_k: {
                with_skill: { passed_cases: 4, total_cases: 4, rate: 1 },
                without_skill: { passed_cases: 2, total_cases: 4, rate: 0.5 },
              },
            },
          },
        }),
      );

    render(<SkillEvaluationReportLoader source={source} fetchImpl={fetchImpl} />);

    await waitFor(() => {
      expect(screen.getByText("95.9%")).toBeTruthy();
    });
    expect(screen.getByRole("rowheader", { name: "Accuracy" })).toBeTruthy();
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      manifest.artifacts.resultUrl,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("keeps completed provenance visible when result.json metrics are unavailable", async () => {
    const index = {
      schemaVersion: 1,
      evaluations: [{ ...source, contentHash }],
    };
    const manifest = completedRecord(source, contentHash, "gpt-5.4-mini");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(index))
      .mockResolvedValueOnce(Response.json(manifest))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    render(<SkillEvaluationReportLoader source={source} fetchImpl={fetchImpl} />);

    await waitFor(() => {
      expect(screen.getByText("Evaluation completed")).toBeTruthy();
    });
    expect(screen.getByText("Metrics unavailable")).toBeTruthy();
    expect(screen.getByRole("link", { name: "result.json" })).toBeTruthy();
  });

  it("shows completed provenance before a slow result.json request finishes", async () => {
    const index = {
      schemaVersion: 1,
      evaluations: [{ ...source, contentHash }],
    };
    const manifest = completedRecord(source, contentHash, "gpt-5.4-mini");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(index))
      .mockResolvedValueOnce(Response.json(manifest))
      .mockImplementationOnce(async () => await new Promise<Response>(() => undefined));

    render(<SkillEvaluationReportLoader source={source} fetchImpl={fetchImpl} />);

    await waitFor(() => {
      expect(screen.getByText("Evaluation completed")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "result.json" })).toBeTruthy();
  });

  it("does not let an aborted request replace the next skill's report", async () => {
    const nextSource = {
      repository: "nvidia/skills",
      commit: "e".repeat(40),
      path: "skills/next-skill",
    };
    const nextContentHash = "f".repeat(64);
    let resolveFirstIndex!: (response: Response) => void;
    const firstIndex = new Promise<Response>((resolve) => {
      resolveFirstIndex = resolve;
    });
    let indexRequests = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/__skill-evaluator-demo/index.json") {
        indexRequests += 1;
        if (indexRequests === 1) return await firstIndex;
        return Response.json({
          schemaVersion: 1,
          evaluations: [{ ...nextSource, contentHash: nextContentHash }],
        });
      }
      if (url.includes(nextContentHash)) {
        return Response.json(pendingRecord(nextSource, nextContentHash, "new-model"));
      }
      return Response.json(pendingRecord(source, contentHash, "old-model"));
    });

    const { rerender } = render(
      <SkillEvaluationReportLoader source={source} fetchImpl={fetchImpl} />,
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    rerender(<SkillEvaluationReportLoader source={nextSource} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByText("new-model")).toBeTruthy());

    resolveFirstIndex(
      Response.json({
        schemaVersion: 1,
        evaluations: [{ ...source, contentHash }],
      }),
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    expect(screen.getByText("new-model")).toBeTruthy();
    expect(screen.queryByText("old-model")).toBeNull();
  });

  it("refreshes a pending manifest until it reaches a terminal state", async () => {
    vi.useFakeTimers();
    try {
      const index = {
        schemaVersion: 1,
        evaluations: [{ ...source, contentHash }],
      };
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(index))
        .mockResolvedValueOnce(Response.json(pendingRecord(source, contentHash, "poll-model")))
        .mockResolvedValueOnce(Response.json(index))
        .mockResolvedValueOnce(
          Response.json({
            ...pendingRecord(source, contentHash, "poll-model"),
            state: "completed",
            timing: {
              startedAt: "2026-08-04T00:00:00.000Z",
              finishedAt: "2026-08-04T00:05:00.000Z",
            },
          }),
        );

      render(<SkillEvaluationReportLoader source={source} fetchImpl={fetchImpl} />);
      await act(async () => {});
      expect(screen.getByText("Evaluation in progress")).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(PENDING_EVALUATION_POLL_INTERVAL_MS);
      });
      expect(screen.getByText("Evaluation completed")).toBeTruthy();
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
