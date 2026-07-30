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
      .mockResolvedValueOnce(response({ value: token("second", now + 10 * 60_000) }));
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
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("completes leaderboard and Trending before automatic activation", async () => {
    const operations: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      operations.push(String(body.operation));
      switch (body.operation) {
        case "status":
          return response({ runs: [] });
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
      leaderboard: { status: "completed" },
      trending: { status: "completed" },
      activation: { activated: true },
      scansPlanned: 0,
      scansAdmitted: 0,
    });
    expect(operations).toEqual([
      "status",
      "configure",
      "start",
      "step",
      "start-trending",
      "step-trending",
      "verify-activate",
      "configure",
      "status",
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
              })
            : response({ runs: [] });
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
          return response({ runs: [] });
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
          return response({ runs: [] });
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
      if (body.operation === "status") return response({ runs: [] });
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
    expect(operations).toEqual(["status", "configure", "start", "step", "deactivate", "configure"]);
  });

  it("closes the skills.sh lane when server-side activation verification fails", async () => {
    const operations: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      operations.push(String(body.operation));
      if (body.operation === "status") return response({ runs: [] });
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
      "start",
      "start-trending",
      "verify-activate",
      "deactivate",
      "configure",
    ]);
  });

  it("preserves the last verified public lane on a transient sync failure", async () => {
    const operations: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      operations.push(String(body.operation));
      if (body.operation === "status") return response({ runs: [] });
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
