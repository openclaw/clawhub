/* @vitest-environment node */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Operation = { operation: string; enabled?: boolean };
type Reply = { status?: number; payload: Record<string, unknown> };

async function runCli(reply: (body: Operation) => Reply, env: NodeJS.ProcessEnv = {}) {
  const directory = await mkdtemp(join(tmpdir(), "skills-sh-sync-"));
  const outputPath = join(directory, "proof.json");
  const operations: Operation[] = [];
  const server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += String(chunk);
    const body = JSON.parse(text) as Operation;
    operations.push(body);
    const result = reply(body);
    response.writeHead(result.status ?? 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(result.payload));
  });
  try {
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port");
    const child = spawn("bun", [resolve("scripts/skills-sh-catalog/sync.ts")], {
      env: {
        PATH: process.env.PATH,
        CLAWHUB_SKILLS_SH_SYNC_URL: `http://127.0.0.1:${address.port}`,
        CLAWHUB_SKILLS_SH_SYNC_TOKEN: "fixture-authorization",
        CLAWHUB_SKILLS_SH_SYNC_OUTPUT: outputPath,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const code = await new Promise<number | null>((done, reject) => {
      child.once("error", reject);
      child.once("close", done);
    });
    const raw = await readFile(outputPath, "utf8");
    return { code, stdout, stderr, raw, proof: JSON.parse(raw), operations };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
}

function successfulReply(body: Operation): Reply {
  if (body.operation === "status") {
    return { payload: { runs: [], invariants: { publicVisible: true } } };
  }
  if (body.operation === "start" || body.operation === "start-trending") {
    const sourceView = body.operation === "start" ? "leaderboard" : "trending";
    return {
      payload: {
        runId: `fixture-${sourceView}`,
        sourceView,
        sourceTotal: 1,
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
                scansPlanned: 0,
                scansAdmitted: 0,
              }
            : {
                observed: 1,
                trendingJoined: 1,
                trendingMissing: 0,
                scansPlanned: 0,
                scansAdmitted: 0,
              },
      },
    };
  }
  return { payload: { ok: true } };
}

describe("skills.sh synchronization CLI receipts", () => {
  it("retains separately bounded, redacted primary and rollback failures after a rollout pause", async () => {
    const diagnostic = String.raw`Authorization: Bearer fixture-secret https://example.invalid/?token=fixture-url-secret API_KEY="fixture-key" password='third\'tail' `;
    const result = await runCli((body) => {
      if (body.operation === "start") {
        return {
          status: 502,
          payload: {
            error: `Convex returned HTTP 400: skills.sh catalog rollout is disabled ${diagnostic}${"x".repeat(6_000)}`,
          },
        };
      }
      if (body.operation === "configure" && !body.enabled) {
        return {
          status: 502,
          payload: { error: `rollback returned HTTP 404 ${diagnostic}${"y".repeat(7_000)}` },
        };
      }
      return successfulReply(body);
    });
    expect(result.code).toBe(1);
    expect(result.proof.ok).toBe(false);
    expect(result.proof.error).toContain("skills.sh catalog rollout is disabled");
    expect(result.proof.error).toContain("[truncated");
    expect(result.proof.error.length).toBeLessThan(2_100);
    expect(result.proof.rollbackErrors).toHaveLength(1);
    expect(result.proof.rollbackErrors[0]).toContain("rollback returned HTTP 404");
    expect(result.proof.rollbackErrors[0]).toContain("[truncated");
    expect(result.proof.rollbackErrors[0].length).toBeLessThan(2_100);
    expect(JSON.parse(result.stdout)).toEqual(result.proof);
    expect(result.stderr).toBe("");
    for (const secret of [
      "fixture-secret",
      "fixture-url-secret",
      "fixture-key",
      "fixture-authorization",
      "third",
      "tail",
    ]) {
      expect(result.raw + result.stdout + result.stderr).not.toContain(secret);
    }
    expect(result.operations.map((body) => body.operation)).toEqual([
      "status",
      "configure",
      "start",
      "configure",
    ]);
    expect(result.operations.at(-1)?.enabled).toBe(false);
  });

  it("records both cleanup errors after a systemic activation failure", async () => {
    const result = await runCli((body) => {
      if (body.operation === "verify-activate") {
        return { status: 409, payload: { error: "corpus reconciliation failed" } };
      }
      if (body.operation === "deactivate") {
        return { status: 503, payload: { error: "deactivation unavailable" } };
      }
      if (body.operation === "configure" && !body.enabled) {
        return { status: 404, payload: { error: "configuration unavailable" } };
      }
      return successfulReply(body);
    });
    expect(result.code).toBe(1);
    expect(result.proof.error).toContain("verify-activate returned HTTP 409");
    expect(result.proof.rollbackErrors).toEqual([
      expect.stringContaining("deactivate returned HTTP 503"),
      expect.stringContaining("configure returned HTTP 404"),
    ]);
    expect(result.operations.slice(-2).map((body) => body.operation)).toEqual([
      "deactivate",
      "configure",
    ]);
  });

  it("distinguishes successful rollback from failure before the rollback scope", async () => {
    const rolledBack = await runCli((body) =>
      body.operation === "start"
        ? { status: 503, payload: { error: "upstream unavailable" } }
        : successfulReply(body),
    );
    expect(rolledBack.code).toBe(1);
    expect(rolledBack.proof).toEqual({
      ok: false,
      error: expect.stringContaining("start returned HTTP 503"),
      rollbackErrors: [],
    });
    const earlyFailure = await runCli(() => ({
      status: 502,
      payload: { error: "status unavailable" },
    }));
    expect(earlyFailure.code).toBe(1);
    expect(earlyFailure.proof).toEqual({
      ok: false,
      error: expect.stringContaining("status returned HTTP 502"),
      rollbackErrors: null,
    });
    expect(earlyFailure.operations.map((body) => body.operation)).toEqual(["status"]);
  });

  it("writes a setup failure without starting synchronization", async () => {
    const result = await runCli(successfulReply, { CLAWHUB_SKILLS_SH_SYNC_URL: "" });
    expect(result.code).toBe(1);
    expect(result.proof).toEqual({
      ok: false,
      error: expect.stringContaining("CLAWHUB_SKILLS_SH_SYNC_URL"),
      rollbackErrors: null,
    });
    expect(result.operations).toEqual([]);
  });

  it("preserves the successful proof and exits zero", async () => {
    const result = await runCli(successfulReply);
    expect(result.code).toBe(0);
    expect(result.proof).toMatchObject({
      ok: true,
      leaderboard: { status: "completed" },
      trending: { status: "completed" },
      scansPlanned: 0,
      scansAdmitted: 0,
    });
    expect(result.proof.rollbackErrors).toBeUndefined();
    expect(JSON.parse(result.stdout)).toEqual(result.proof);
    expect(result.operations.map((body) => body.operation)).toEqual([
      "status",
      "configure",
      "start",
      "start-trending",
      "verify-activate",
      "configure",
      "status",
    ]);
  });
});
