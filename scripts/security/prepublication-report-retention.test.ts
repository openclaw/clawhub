/* @vitest-environment node */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { processPrePublicationAttempt, runNativeClawScan } from "./run-prepublication-worker";

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../lib/workerLogger", () => ({ createWorkerLogger: () => logs }));
const workspaces: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  await Promise.all(workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("stores private execution evidence before normal completion without changing its verdict", async () => {
  const calls: string[] = [];
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push("upload");
    const body = JSON.parse(String(init.body));
    expect(body.attempt.files).toEqual([{ path: "SKILL.md", size: 2, sha256: "a".repeat(64) }]);
    expect(JSON.stringify(body)).not.toContain("signed-artifact-url");
    expect(body.projections.analysis.verdict).toBe("suspicious");
    expect(body.execution.stdout).toBe("private source canary");
    return new Response(JSON.stringify({ receiptId: "controlled-receipt" }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetcher);
  const action = vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
    if (args.storageId) {
      calls.push("retain");
      expect(args).not.toHaveProperty("execution");
      return { receiptId: "controlled-receipt" };
    }
    calls.push("complete");
    expect(args.clawscan).toMatchObject({ status: "clean" });
    expect(args.clawscanAnalysis).toMatchObject({ verdict: "suspicious" });
    return { status: "finalized" };
  });
  await processPrePublicationAttempt(
    { action } as never,
    "controlled-worker-token",
    {
      attemptId: "controlled-attempt" as Id<"publishAttempts">,
      claimId: "controlled-claim",
      kind: "skill",
      slug: "controlled",
      displayName: "Controlled",
      version: "1.0.0",
      artifactFingerprint: "a".repeat(64),
      createdAt: 1,
      checkClaimExpiresAt: Date.now() + 60_000,
      prepublicationReportUploadUrl: "https://controlled.invalid/private-upload",
      files: [
        {
          path: "SKILL.md",
          size: 2,
          sha256: "a".repeat(64),
          url: "https://controlled.invalid/signed-artifact-url",
        },
      ],
    },
    {
      writeWorkspace: async () => {},
      runTruffleHog: async () => ({ status: "clean" }),
      runClawScan: async (_job, _workspace, _exposure, retain) => {
        await retain?.({
          startedAt: 1,
          completedAt: 2,
          exitCode: 0,
          stdout: "private source canary",
          stderr: "",
          failure: null,
          artifact: {
            presence: "missing",
            encoding: "base64",
            content: null,
            bytes: null,
            sha256: null,
          },
        });
        return {
          check: { status: "clean" },
          analysis: { status: "suspicious", verdict: "suspicious", checkedAt: 2 },
        };
      },
    },
  );
  expect(calls).toEqual(["upload", "complete"]);
  expect(JSON.stringify(logs.info.mock.calls)).not.toContain("private source canary");
});

it.each(["upload", "receipt", "old-backend"])(
  "keeps normal publication independent of %s retention failures",
  async (failure) => {
    const fetcher = vi.fn(async () => {
      if (failure === "upload") throw new Error("private-provider-error-canary");
      return new Response(JSON.stringify({ receiptId: "controlled-receipt" }), {
        status: failure === "receipt" ? 503 : 200,
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const action = vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
      if (args.storageId) throw new Error("private-provider-error-canary");
      expect(args.clawscan).toMatchObject({ status: "clean" });
      return { status: "finalized" };
    });
    const result = await processPrePublicationAttempt(
      { action } as never,
      "controlled-token",
      {
        attemptId: "controlled-attempt" as Id<"publishAttempts">,
        claimId: "controlled-claim",
        kind: "skill",
        slug: "controlled",
        displayName: "Controlled",
        version: "1.0.0",
        artifactFingerprint: "a".repeat(64),
        createdAt: 1,
        checkClaimExpiresAt: Date.now() + 60_000,
        files: [],
        ...(failure === "old-backend"
          ? {}
          : { prepublicationReportUploadUrl: "https://controlled.invalid/private-upload" }),
      },
      {
        writeWorkspace: async () => {},
        runTruffleHog: async () => ({ status: "clean" }),
        runClawScan: async (_job, _workspace, _exposure, retain) => {
          await retain?.({
            startedAt: 1,
            completedAt: 2,
            exitCode: 0,
            stdout: "private-source-canary",
            stderr: "",
            failure: null,
            artifact: {
              presence: "missing",
              encoding: "base64",
              content: null,
              bytes: null,
              sha256: null,
            },
          });
          return {
            check: { status: "clean" },
            analysis: { status: "clean", verdict: "benign", checkedAt: 2 },
          };
        },
      },
    );
    expect(result.completed).toBe(true);
    expect(action.mock.calls.filter(([, args]) => !args.storageId)).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(failure === "old-backend" ? 0 : 1);
    expect(JSON.stringify(logs.warn.mock.calls)).not.toMatch(
      /private-provider-error-canary|private-source-canary|private-upload/,
    );
  },
);

it("retains the complete failed native execution before the workspace is removed", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "prepublication-report-retention-"));
  workspaces.push(workspace);
  await mkdir(join(workspace, "artifact"));
  await writeFile(join(workspace, "artifact/SKILL.md"), "# Controlled fixture\n");
  const artifact = JSON.stringify({
    schemaVersion: "clawscan-run-v1",
    profile: "clawhub",
    runId: "controlled-native-run",
    scanners: {
      skillspector: {
        status: "failed",
        raw: {
          issues: Array.from({ length: 30 }, (_, index) => ({ evidence: `private-${index}` })),
        },
      },
    },
    judge: { status: "not_started" },
  });
  const command = join(workspace, "clawscan-fixture");
  await writeFile(
    command,
    `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.argv[process.argv.indexOf('--output') + 1], ${JSON.stringify(artifact)});
process.stdout.write('private native stdout');
process.stderr.write('private native stderr');
process.exit(1);
`,
  );
  await chmod(command, 0o755);
  vi.stubEnv("PREPUBLICATION_CLAWSCAN_COMMAND", command);
  const reports: unknown[] = [];
  const result = await runNativeClawScan(
    {
      job: {
        _id: "controlled-attempt",
        leaseToken: "controlled-claim",
        source: "pre-publication",
        targetKind: "skillVersion",
        attempts: 1,
        hasMaliciousSignal: false,
      },
      target: {},
    },
    workspace,
    undefined,
    async (report) => {
      expect(await readFile(join(workspace, "clawscan-result.json"), "utf8")).toBe(artifact);
      reports.push(report);
    },
  );
  expect(result.check.status).toBe("failed");
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({
    exitCode: 1,
    stdout: "private native stdout",
    stderr: "private native stderr",
    artifact: {
      encoding: "base64",
      content: Buffer.from(artifact).toString("base64"),
      presence: "present",
    },
  });
  expect(JSON.stringify(logs.info.mock.calls)).not.toContain("private-29");
});
