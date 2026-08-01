/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { createGitHubActionsOidcAuthorization, runSkillsShSync } from "./sync";

function response(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

function completedRun(sourceView: "leaderboard" | "trending", scansPlanned = 0) {
  return {
    runId: `run-${sourceView}`,
    snapshotId: `snapshot-${sourceView}`,
    sourceView,
    sourceTotal: 1,
    sourcePageSize: 500,
    sourceMeasuredAt: "2026-07-30T06:00:00.000Z",
    page: 1,
    offset: 0,
    status: "completed",
    counts:
      sourceView === "leaderboard"
        ? {
            observed: 1,
            inserted: 1,
            updated: 0,
            unchanged: 0,
            rejected: 0,
            conflicts: 0,
            quarantined: 0,
            detailsInserted: 1,
            detailsUpdated: 0,
            detailsUnchanged: 0,
            detailsMissing: 0,
            scansPlanned,
            scansAdmitted: 0,
          }
        : {
            observed: 1,
            trendingJoined: 1,
            trendingMissing: 0,
            scansPlanned,
            scansAdmitted: 0,
          },
  };
}

function nativeTrendingPreparation() {
  return response({
    ok: true,
    nativeTrending: {
      status: "ready",
      snapshotId: "skills-native-before-import",
      sourceCounts: { clawhubTrending: 1, clawhubRising: 1, skillsShTrending: 0 },
      nativePool: {
        poolId: "skills-native-before-import",
        sourceCounts: { clawhubTrending: 1, clawhubRising: 1 },
      },
    },
  });
}

describe("skills.sh synchronization runner", () => {
  it("refreshes GitHub OIDC authorization before the cached token expires", async () => {
    let now = 1_000_000;
    const token = (value: string, expiresAt: number) => {
      const payload = Buffer.from(JSON.stringify({ exp: Math.floor(expiresAt / 1_000) })).toString(
        "base64url",
      );
      return `header.${payload}.${value}`;
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ value: token("first", now + 5 * 60_000) }))
      .mockResolvedValueOnce(response({ value: token("second", now + 10 * 60_000) }))
      .mockResolvedValueOnce(response({ value: token("forced", now + 10 * 60_000) }));
    const authorization = createGitHubActionsOidcAuthorization({
      requestUrl: "https://token.actions.example/id-token?job=sync",
      requestToken: "request-token",
      fetchImpl,
      now: () => now,
    });

    await expect(authorization()).resolves.toContain(".first");
    now += 2 * 60_000;
    await expect(authorization()).resolves.toContain(".first");
    now += 2 * 60_000;
    await expect(authorization()).resolves.toContain(".second");
    await expect(authorization(true)).resolves.toContain(".forced");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("completes leaderboard and Trending before automatic activation", async () => {
    const operations: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      operations.push(String(body.operation));
      switch (body.operation) {
        case "status":
          return response({ runs: [], invariants: { publicVisible: false } });
        case "prepare-native-trending":
          return nativeTrendingPreparation();
        case "configure":
          return response({ ok: true, enabled: body.enabled });
        case "start":
          return response({
            runId: "run-leaderboard",
            sourceView: "leaderboard",
            sourceTotal: 1,
            page: 0,
            offset: 0,
            status: "running",
          });
        case "step":
          return response(completedRun("leaderboard"));
        case "start-trending":
          return response({
            runId: "run-trending",
            sourceView: "trending",
            sourceTotal: 1,
            page: 0,
            offset: 0,
            status: "running",
          });
        case "step-trending":
          return response(completedRun("trending"));
        case "verify-activate":
          return response({ ok: true, activated: true });
        default:
          throw new Error(`unexpected operation ${String(body.operation)}`);
      }
    });

    await expect(
      runSkillsShSync({
        targetUrl: "https://clawhub.ai/ops/skills-sh/mirror",
        authorization: "github-oidc",
        reason: "scheduled proof",
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      ok: true,
      nativeBefore: {
        nativeTrending: {
          status: "ready",
          sourceCounts: { skillsShTrending: 0 },
        },
      },
      leaderboard: { status: "completed" },
      trending: { status: "completed" },
      activation: { activated: true },
      scansPlanned: 0,
      scansAdmitted: 0,
    });
    expect(operations).toEqual([
      "status",
      "configure",
      "prepare-native-trending",
      "start",
      "step",
      "start-trending",
      "step-trending",
      "verify-activate",
      "configure",
      "status",
    ]);
  });

  it("waits for a timed-out native preflight to finish without starting it twice", async () => {
    const operations: string[] = [];
    const sleep = vi.fn(async () => undefined);
    let statusCalls = 0;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      operations.push(String(body.operation));
      if (body.operation === "status") {
        statusCalls += 1;
        if (statusCalls === 1) {
          return response({ runs: [], invariants: { publicVisible: false } });
        }
        if (statusCalls === 2) {
          return response({
            control: {
              activationLockToken: "skills-sh-native-trending:in-flight",
              activationLockedAt: 1_722_345_678_000,
              reason: "scheduled proof native-only preflight",
            },
            nativeTrending: null,
            runs: [],
            invariants: { publicVisible: false },
          });
        }
        if (statusCalls === 3) {
          return response({
            control: {},
            nativeTrending: {
              status: "ready",
              snapshotId: "skills-native-after-timeout",
              sourceCounts: { clawhubTrending: 1, clawhubRising: 1, skillsShTrending: 0 },
              nativePool: {
                poolId: "skills-native-after-timeout",
                sourceCounts: { clawhubTrending: 1, clawhubRising: 1 },
              },
            },
            runs: [],
            invariants: { publicVisible: false },
          });
        }
        return response({ runs: [], invariants: { publicVisible: true } });
      }
      if (body.operation === "prepare-native-trending") {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }
      if (body.operation === "configure") return response({ ok: true });
      if (body.operation === "start") return response(completedRun("leaderboard"));
      if (body.operation === "start-trending") return response(completedRun("trending"));
      if (body.operation === "verify-activate") {
        return response({ ok: true, activated: true });
      }
      throw new Error(`unexpected operation ${String(body.operation)}`);
    });

    await expect(
      runSkillsShSync({
        targetUrl: "https://clawhub.ai/ops/skills-sh/mirror",
        authorization: "github-oidc",
        reason: "scheduled proof",
        fetchImpl,
        sleep,
      }),
    ).resolves.toMatchObject({
      ok: true,
      nativeBefore: {
        nativeTrending: {
          status: "ready",
          snapshotId: "skills-native-after-timeout",
          sourceCounts: { skillsShTrending: 0 },
        },
        reconciledAfterTimeout: true,
      },
    });
    expect(sleep).toHaveBeenCalledExactlyOnceWith(5_000);
    expect(operations).toEqual([
      "status",
      "configure",
      "prepare-native-trending",
      "status",
      "status",
      "start",
      "start-trending",
      "verify-activate",
      "configure",
      "status",
    ]);
  });

  it("fails closed when timed-out native readiness has a mismatched candidate pool", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (body.operation === "status") {
        return fetchImpl.mock.calls.length === 1
          ? response({ runs: [], invariants: { publicVisible: false } })
          : response({
              control: {},
              nativeTrending: {
                status: "ready",
                snapshotId: "skills-native-after-timeout",
                sourceCounts: { clawhubTrending: 1, clawhubRising: 1, skillsShTrending: 0 },
                nativePool: {
                  poolId: "skills-different-native-pool",
                  sourceCounts: { clawhubTrending: 1, clawhubRising: 1 },
                },
              },
              runs: [],
              invariants: { publicVisible: false },
            });
      }
      if (body.operation === "prepare-native-trending") {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }
      if (body.operation === "configure") return response({ ok: true });
      throw new Error(`unexpected operation ${String(body.operation)}`);
    });

    await expect(
      runSkillsShSync({
        targetUrl: "https://clawhub.ai/ops/skills-sh/mirror",
        authorization: "github-oidc",
        reason: "scheduled proof",
        fetchImpl,
      }),
    ).rejects.toThrow("native-only Trending snapshot and candidate pool do not match");
  });

  it("fails closed when a timed-out native preflight releases without a ready snapshot", async () => {
    const operations: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      operations.push(String(body.operation));
      if (body.operation === "status") {
        return operations.length === 1
          ? response({ runs: [], invariants: { publicVisible: false } })
          : response({
              control: {},
              nativeTrending: null,
              runs: [],
              invariants: { publicVisible: false },
            });
      }
      if (body.operation === "prepare-native-trending") {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }
      if (body.operation === "configure") return response({ ok: true });
      throw new Error(`unexpected operation ${String(body.operation)}`);
    });

    await expect(
      runSkillsShSync({
        targetUrl: "https://clawhub.ai/ops/skills-sh/mirror",
        authorization: "github-oidc",
        reason: "scheduled proof",
        fetchImpl,
      }),
    ).rejects.toThrow("native-only Trending preflight finished without a ready snapshot");
    expect(operations).toEqual([
      "status",
      "configure",
      "prepare-native-trending",
      "status",
      "configure",
    ]);
  });

  it("fails closed when a timed-out native preflight is replaced by another lock", async () => {
    const operations: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      operations.push(String(body.operation));
      if (body.operation === "status") {
        return operations.length === 1
          ? response({ runs: [], invariants: { publicVisible: false } })
          : response({
              control: {
                activationLockToken: "skills-sh-activation:different-operation",
                reason: "another activation",
              },
              nativeTrending: null,
              runs: [],
              invariants: { publicVisible: false },
            });
      }
      if (body.operation === "prepare-native-trending") {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }
      if (body.operation === "configure") return response({ ok: true });
      throw new Error(`unexpected operation ${String(body.operation)}`);
    });

    await expect(
      runSkillsShSync({
        targetUrl: "https://clawhub.ai/ops/skills-sh/mirror",
        authorization: "github-oidc",
        reason: "scheduled proof",
        fetchImpl,
      }),
    ).rejects.toThrow("timed-out native Trending preflight is bound to a different lock");
    expect(operations).toEqual([
      "status",
      "configure",
      "prepare-native-trending",
      "status",
      "configure",
    ]);
  });

  it("resumes an interrupted durable run before starting the next source view", async () => {
    const operations: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      operations.push(String(body.operation));
      switch (body.operation) {
        case "status":
          return operations.length === 1
            ? response({
                runs: [
                  {
                    runId: "run-leaderboard",
                    snapshotId: "skills-sh:leaderboard:interrupted",
                    sourceView: "leaderboard",
                    sourceTotal: 1,
                    sourcePageSize: 500,
                    sourceMeasuredAt: "2026-07-30T06:00:00.000Z",
                    page: 0,
                    offset: 0,
                    status: "running",
                    startedAt: 1,
                  },
                ],
                invariants: { publicVisible: false },
              })
            : response({ runs: [], invariants: { publicVisible: true } });
        case "prepare-native-trending":
          return nativeTrendingPreparation();
        case "configure":
          return response({ ok: true, enabled: body.enabled });
        case "step":
          return response(completedRun("leaderboard"));
        case "start-trending":
          return response(completedRun("trending"));
        case "verify-activate":
          return response({ ok: true, activated: true });
        default:
          throw new Error(`unexpected operation ${String(body.operation)}`);
      }
    });

    await expect(
      runSkillsShSync({
        targetUrl: "https://clawhub.ai/ops/skills-sh/mirror",
        authorization: "github-oidc",
        reason: "scheduled recovery",
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      ok: true,
      leaderboard: { status: "completed" },
      trending: { status: "completed" },
    });
    expect(operations).toEqual([
      "status",
      "configure",
      "prepare-native-trending",
      "step",
      "start-trending",
      "verify-activate",
      "configure",
      "status",
    ]);
  });

  it("refreshes authorization and reconciles the durable cursor after an operator 401", async () => {
    const operations: string[] = [];
    let refreshed = false;
    const authorization = vi.fn(async (forceRefresh?: boolean) => {
      if (forceRefresh) refreshed = true;
      return refreshed ? "fresh-github-oidc" : "stale-github-oidc";
    });
    const running = {
      runId: "run-leaderboard",
      snapshotId: "skills-sh:leaderboard:durable",
      sourceView: "leaderboard",
      sourceTotal: 1,
      sourcePageSize: 500,
      sourceMeasuredAt: "2026-08-01T05:32:30.080Z",
      page: 17,
      offset: 300,
      status: "running",
      startedAt: 1,
    };
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const bearer = String((init.headers as Record<string, string>).Authorization);
      operations.push(String(body.operation));
      switch (body.operation) {
        case "status":
          return response({ runs: [running], invariants: { publicVisible: true } });
        case "configure":
          return response({ ok: true, enabled: body.enabled });
        case "step":
          if (bearer === "Bearer stale-github-oidc") {
            return response(
              {
                error: "skills_sh_mirror_test_failed",
                message: "Convex Test mirror operator returned HTTP 401: Unauthorized",
              },
              502,
            );
          }
          return response(completedRun("leaderboard"));
        case "run":
          expect(bearer).toBe("Bearer fresh-github-oidc");
          return response(running);
        case "start-trending":
          return response(completedRun("trending"));
        case "verify-activate":
          return response({ ok: true, activated: true });
        default:
          throw new Error(`unexpected operation ${String(body.operation)}`);
      }
    });

    await expect(
      runSkillsShSync({
        targetUrl: "https://clawhub.ai/ops/skills-sh/mirror",
        authorization,
        reason: "scheduled recovery",
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      ok: true,
      leaderboard: {
        runId: "run-leaderboard",
        syncProof: { authorizationRetries: 1 },
      },
      scansPlanned: 0,
      scansAdmitted: 0,
    });
    expect(authorization).toHaveBeenCalledWith(true);
    expect(operations).toEqual([
      "status",
      "configure",
      "step",
      "run",
      "step",
      "start-trending",
      "verify-activate",
      "configure",
      "status",
    ]);
  });

  it("retries the exact durable cursor after a rate-limit backoff and ambiguous timeout", async () => {
    const requests: string[] = [];
    const sleep = vi.fn(async () => undefined);
    let stepAttempts = 0;
    const running = {
      runId: "run-leaderboard",
      snapshotId: "skills-sh:leaderboard:durable",
      sourceView: "leaderboard",
      sourceTotal: 1,
      sourcePageSize: 500,
      sourceMeasuredAt: "2026-07-30T06:00:00.000Z",
      page: 9,
      offset: 50,
      status: "running",
      startedAt: 1,
    };
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      requests.push(
        `${String(body.operation)}${body.page === undefined ? "" : `:${body.page}:${body.offset}`}`,
      );
      switch (body.operation) {
        case "status":
          return response({ runs: [], invariants: { publicVisible: false } });
        case "prepare-native-trending":
          return nativeTrendingPreparation();
        case "configure":
          return response({ ok: true, enabled: body.enabled });
        case "start":
          return response(running);
        case "step":
          stepAttempts += 1;
          if (stepAttempts === 1) {
            return new Response(JSON.stringify({ error: "rate_limited" }), {
              status: 429,
              headers: { "retry-after": "1" },
            });
          }
          if (stepAttempts === 2) {
            throw new DOMException("The operation timed out.", "TimeoutError");
          }
          return response(completedRun("leaderboard"));
        case "run":
          return response(running);
        case "start-trending":
          return response(completedRun("trending"));
        case "verify-activate":
          return response({ ok: true, activated: true });
        default:
          throw new Error(`unexpected operation ${String(body.operation)}`);
      }
    });

    await expect(
      runSkillsShSync({
        targetUrl: "https://clawhub.ai/ops/skills-sh/mirror",
        authorization: "github-oidc",
        reason: "scheduled recovery",
        fetchImpl,
        sleep,
      }),
    ).resolves.toMatchObject({
      ok: true,
      leaderboard: {
        runId: "run-leaderboard",
        syncProof: { rateLimitRetries: 1, transportTimeouts: 1 },
      },
      scansPlanned: 0,
      scansAdmitted: 0,
    });
    expect(sleep).toHaveBeenCalledExactlyOnceWith(1_000);
    expect(requests).toEqual([
      "status",
      "configure",
      "prepare-native-trending",
      "start",
      "step:9:50",
      "step:9:50",
      "run",
      "step:9:50",
      "start-trending",
      "verify-activate",
      "configure",
      "status",
    ]);
  });

  it("continues from the authoritative cursor when a timed-out step already committed", async () => {
    const stepCursors: string[] = [];
    const running = {
      runId: "run-leaderboard",
      snapshotId: "skills-sh:leaderboard:durable",
      sourceView: "leaderboard",
      sourceTotal: 1,
      sourcePageSize: 500,
      sourceMeasuredAt: "2026-07-30T06:00:00.000Z",
      page: 9,
      offset: 50,
      status: "running",
      startedAt: 1,
    };
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      switch (body.operation) {
        case "status":
          return response({ runs: [], invariants: { publicVisible: false } });
        case "prepare-native-trending":
          return nativeTrendingPreparation();
        case "configure":
          return response({ ok: true, enabled: body.enabled });
        case "start":
          return response(running);
        case "step":
          stepCursors.push(`${body.page}:${body.offset}`);
          if (body.offset === 50) {
            throw new DOMException("The operation timed out.", "TimeoutError");
          }
          return response(completedRun("leaderboard"));
        case "run":
          return response({ ...running, offset: 100 });
        case "start-trending":
          return response(completedRun("trending"));
        case "verify-activate":
          return response({ ok: true, activated: true });
        default:
          throw new Error(`unexpected operation ${String(body.operation)}`);
      }
    });

    await expect(
      runSkillsShSync({
        targetUrl: "https://clawhub.ai/ops/skills-sh/mirror",
        authorization: "github-oidc",
        reason: "scheduled recovery",
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      ok: true,
      leaderboard: { syncProof: { steps: 2, transportTimeouts: 1 } },
      scansPlanned: 0,
      scansAdmitted: 0,
    });
    expect(stepCursors).toEqual(["9:50", "9:100"]);
  });

  it("closes only the skills.sh lane when a systemic invariant fails", async () => {
    const operations: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      operations.push(String(body.operation));
      if (body.operation === "status") {
        return response({ runs: [], invariants: { publicVisible: false } });
      }
      if (body.operation === "prepare-native-trending") return nativeTrendingPreparation();
      if (body.operation === "configure") return response({ ok: true });
      if (body.operation === "start") {
        return response({
          runId: "run-leaderboard",
          sourceView: "leaderboard",
          sourceTotal: 1,
          page: 0,
          offset: 0,
          status: "running",
        });
      }
      if (body.operation === "step") return response(completedRun("leaderboard", 1));
      if (body.operation === "deactivate") return response({ ok: true, enabled: false });
      throw new Error(`unexpected operation ${String(body.operation)}`);
    });

    await expect(
      runSkillsShSync({
        targetUrl: "https://clawhub.ai/ops/skills-sh/mirror",
        authorization: "github-oidc",
        reason: "scheduled proof",
        fetchImpl,
      }),
    ).rejects.toThrow("scheduled a ClawHub scan");
    expect(operations).toEqual([
      "status",
      "configure",
      "prepare-native-trending",
      "start",
      "step",
      "deactivate",
      "configure",
    ]);
  });

  it("closes the skills.sh lane when server-side activation verification fails", async () => {
    const operations: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      operations.push(String(body.operation));
      if (body.operation === "status") {
        return response({ runs: [], invariants: { publicVisible: false } });
      }
      if (body.operation === "prepare-native-trending") return nativeTrendingPreparation();
      if (body.operation === "configure") return response({ ok: true });
      if (body.operation === "start") return response(completedRun("leaderboard"));
      if (body.operation === "start-trending") return response(completedRun("trending"));
      if (body.operation === "verify-activate") {
        return response({ error: "corpus reconciliation failed" }, 409);
      }
      if (body.operation === "deactivate") return response({ ok: true, enabled: false });
      throw new Error(`unexpected operation ${String(body.operation)}`);
    });

    await expect(
      runSkillsShSync({
        targetUrl: "https://clawhub.ai/ops/skills-sh/mirror",
        authorization: "github-oidc",
        reason: "scheduled proof",
        fetchImpl,
      }),
    ).rejects.toThrow("verify-activate returned HTTP 409");
    expect(operations).toEqual([
      "status",
      "configure",
      "prepare-native-trending",
      "start",
      "start-trending",
      "verify-activate",
      "deactivate",
      "configure",
    ]);
  });

  it("reconciles an ambiguous activation timeout only from the exact durable activation receipt", async () => {
    const operations: string[] = [];
    let statusCalls = 0;
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      operations.push(String(body.operation));
      if (body.operation === "status") {
        statusCalls += 1;
        if (statusCalls === 1) {
          return response({ runs: [], invariants: { publicVisible: false } });
        }
        if (statusCalls === 2) {
          return response({
            control: {
              activationLockToken: "skills-sh-activation:in-flight",
              activationLeaderboardRunId: "run-leaderboard",
              activationTrendingRunId: "run-trending",
            },
            runs: [],
            invariants: { publicVisible: false },
          });
        }
        return response({ runs: [], invariants: { publicVisible: true } });
      }
      if (body.operation === "prepare-native-trending") return nativeTrendingPreparation();
      if (body.operation === "configure") return response({ ok: true });
      if (body.operation === "start") return response(completedRun("leaderboard"));
      if (body.operation === "start-trending") return response(completedRun("trending"));
      if (body.operation === "verify-activate") {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }
      if (body.operation === "run") {
        return statusCalls === 1
          ? response(completedRun("leaderboard"))
          : response({
              ...completedRun("leaderboard"),
              activatedTrendingRunId: "run-trending",
              activationSnapshotId: "skills-activation",
              activatedAt: 1_722_345_678_000,
            });
      }
      throw new Error(`unexpected operation ${String(body.operation)}`);
    });

    await expect(
      runSkillsShSync({
        targetUrl: "https://clawhub.ai/ops/skills-sh/mirror",
        authorization: "github-oidc",
        reason: "scheduled proof",
        fetchImpl,
        sleep,
      }),
    ).resolves.toMatchObject({
      ok: true,
      activation: {
        activated: true,
        reconciledAfterTimeout: true,
        leaderboardRunId: "run-leaderboard",
        trendingRunId: "run-trending",
        snapshotId: "skills-activation",
      },
    });
    expect(sleep).toHaveBeenCalled();
    expect(operations).toEqual([
      "status",
      "configure",
      "prepare-native-trending",
      "start",
      "start-trending",
      "verify-activate",
      "run",
      "status",
      "run",
      "configure",
      "status",
    ]);
  });

  it("does not wait past the final activation receipt reconciliation read", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (body.operation === "status") {
        return response({
          control: {
            activationLockToken: "skills-sh-activation:in-flight",
            activationLeaderboardRunId: "run-leaderboard",
            activationTrendingRunId: "run-trending",
          },
          runs: [],
          invariants: { publicVisible: false },
        });
      }
      if (body.operation === "prepare-native-trending") return nativeTrendingPreparation();
      if (body.operation === "configure") return response({ ok: true });
      if (body.operation === "start") return response(completedRun("leaderboard"));
      if (body.operation === "start-trending") return response(completedRun("trending"));
      if (body.operation === "verify-activate") {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }
      if (body.operation === "run") return response(completedRun("leaderboard"));
      throw new Error(`unexpected operation ${String(body.operation)}`);
    });

    await expect(
      runSkillsShSync({
        targetUrl: "https://clawhub.ai/ops/skills-sh/mirror",
        authorization: "github-oidc",
        reason: "scheduled proof",
        fetchImpl,
        sleep,
      }),
    ).rejects.toThrow("did not produce an exact durable activation receipt");
    expect(sleep).toHaveBeenCalledTimes(359);
  });

  it("preserves the last verified public lane on a transient sync failure", async () => {
    const operations: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      operations.push(String(body.operation));
      if (body.operation === "status") {
        return response({ runs: [], invariants: { publicVisible: true } });
      }
      if (body.operation === "configure") return response({ ok: true });
      if (body.operation === "start") return response({ error: "upstream unavailable" }, 503);
      throw new Error(`unexpected operation ${String(body.operation)}`);
    });

    await expect(
      runSkillsShSync({
        targetUrl: "https://clawhub.ai/ops/skills-sh/mirror",
        authorization: "github-oidc",
        reason: "scheduled proof",
        fetchImpl,
      }),
    ).rejects.toThrow("start returned HTTP 503");
    expect(operations).toEqual(["status", "configure", "start", "configure"]);
  });
});
