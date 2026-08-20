import { afterEach, describe, expect, it, vi } from "vitest";
import { failSkillEvaluation, skipSkillEvaluation } from "./skillEvaluations";

type RunMutation = (ref: unknown, args: unknown) => Promise<unknown>;

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: { runMutation: RunMutation }, args: TArgs) => Promise<TResult>;
};

type TerminalActionArgs = {
  token: string;
  runId: string;
  leaseToken: string;
};

const skipSkillEvaluationHandler = (
  skipSkillEvaluation as unknown as WrappedHandler<
    TerminalActionArgs & { reason: string },
    { ok: true }
  >
)._handler;

const failSkillEvaluationHandler = (
  failSkillEvaluation as unknown as WrappedHandler<
    TerminalActionArgs & { error: string },
    { ok: true; retry: boolean }
  >
)._handler;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("skill evaluation worker terminal actions", () => {
  it("forwards only internal skip arguments after authenticating the worker", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "expected-worker-token");
    const runMutation = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({});

    await expect(
      skipSkillEvaluationHandler(
        { runMutation },
        {
          token: "expected-worker-token",
          runId: "skillEvaluationRuns:skip",
          leaseToken: "skip-lease",
          reason: "not applicable",
        },
      ),
    ).resolves.toEqual({ ok: true });
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      runId: "skillEvaluationRuns:skip",
      leaseToken: "skip-lease",
      reason: "not applicable",
    });
  });

  it("forwards only internal failure arguments after authenticating the worker", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "expected-worker-token");
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, retry: false })
      .mockResolvedValueOnce({});

    await expect(
      failSkillEvaluationHandler(
        { runMutation },
        {
          token: "expected-worker-token",
          runId: "skillEvaluationRuns:fail",
          leaseToken: "fail-lease",
          error: "synthetic worker failure",
        },
      ),
    ).resolves.toEqual({ ok: true, retry: false });
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      runId: "skillEvaluationRuns:fail",
      leaseToken: "fail-lease",
      error: "synthetic worker failure",
    });
  });

  it.each([
    {
      name: "skip",
      invoke: (runMutation: RunMutation) =>
        skipSkillEvaluationHandler(
          { runMutation },
          {
            token: "invalid-worker-token",
            runId: "skillEvaluationRuns:skip",
            leaseToken: "skip-lease",
            reason: "not applicable",
          },
        ),
    },
    {
      name: "fail",
      invoke: (runMutation: RunMutation) =>
        failSkillEvaluationHandler(
          { runMutation },
          {
            token: "invalid-worker-token",
            runId: "skillEvaluationRuns:fail",
            leaseToken: "fail-lease",
            error: "synthetic worker failure",
          },
        ),
    },
  ])("rejects an invalid external token before the $name mutation", async ({ invoke }) => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "expected-worker-token");
    const runMutation = vi.fn(async () => undefined);

    await expect(invoke(runMutation)).rejects.toThrow("Unauthorized");
    expect(runMutation).not.toHaveBeenCalled();
  });
});
