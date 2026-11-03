/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { PrepublicationReport } from "./lib/prepublicationReports";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());
async function digest(body: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function fixture() {
  vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "report-fixture-token");
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { role: "user" });
    const staffId = await ctx.db.insert("users", { role: "moderator" });
    const skillId = await ctx.db.insert("skills", {
      slug: "private-report-fixture",
      displayName: "Private report fixture",
      ownerUserId: ownerId,
      tags: {},
      stats: { comments: 0, downloads: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    });
    const versionId = await ctx.db.insert("skillVersions", {
      skillId,
      version: "1.0.0",
      publicationStatus: "pending",
      fingerprint: "a".repeat(64),
      changelog: "fixture",
      files: [],
      parsed: { frontmatter: {} },
      createdBy: ownerId,
      createdAt: 1,
    });
    const attemptId = await ctx.db.insert("publishAttempts", {
      kind: "skill",
      status: "pending_checks",
      userId: ownerId,
      skillId,
      skillVersionId: versionId,
      slug: "private-report-fixture",
      displayName: "Private report fixture",
      version: "1.0.0",
      artifactFingerprint: "a".repeat(64),
      idempotencyKey: "private-report-fixture",
      files: [],
      checks: { trufflehog: { status: "pending" }, clawscan: { status: "pending" } },
      checkClaimId: "claim-fixture",
      checkClaimExpiresAt: Date.now() + 60_000,
      createdAt: 1,
      updatedAt: 1,
      expiresAt: Date.now() + 60_000,
    });
    return { ownerId, staffId, attemptId, versionId };
  });
  const envelope: PrepublicationReport = {
    schemaVersion: "clawhub-prepublication-execution-v1",
    attempt: {
      id: ids.attemptId,
      claimId: "claim-fixture",
      artifactFingerprint: "a".repeat(64),
      kind: "skill",
      slug: "private-report-fixture",
      version: "1.0.0",
      files: [],
    },
    source: {
      workerId: "fixture-worker",
      workerRevision: "b".repeat(40),
      githubRunId: "123",
      githubRunAttempt: "1",
      configuredClawscanSourceCommit: "c".repeat(40),
      nodeVersion: "v24.0.0",
      platform: "linux",
      arch: "x64",
    },
    execution: {
      startedAt: 1,
      completedAt: 2,
      exitCode: 1,
      stdout: "private stdout",
      stderr: "private provider text",
      failure: null,
      artifact: {
        presence: "missing",
        encoding: "base64",
        content: null,
        bytes: null,
        sha256: null,
      },
    },
    projections: { check: { status: "failed", summary: "Scanner failed" } },
  };
  const post = async (
    value: unknown = envelope,
    options: {
      token?: string;
      headers?: Record<string, string>;
      body?: string;
      contentType?: string;
    } = {},
  ) => {
    const body = options.body ?? JSON.stringify(value);
    return await t.fetch("/api/internal/prepublication-reports", {
      method: "POST",
      body,
      headers: {
        Authorization: `Bearer ${options.token ?? "report-fixture-token"}`,
        "Content-Type": options.contentType ?? "application/json",
        "X-ClawHub-Attempt-Id": ids.attemptId,
        "X-ClawHub-Claim-Id": (value as typeof envelope)?.attempt?.claimId ?? "claim-fixture",
        "X-ClawHub-Artifact-Fingerprint": "a".repeat(64),
        "X-ClawHub-Report-SHA256": await digest(body),
        ...options.headers,
      },
    });
  };
  return { t, ids, envelope, post, staff: t.withIdentity({ subject: `${ids.staffId}|session` }) };
}

it("creates private report storage itself and keeps one immutable exact-claim receipt", async () => {
  const f = await fixture();
  const before = await f.t.run((ctx) => ctx.db.get(f.ids.attemptId));
  const response = await f.post();
  expect(response.status).toBe(200);
  const result = await response.json();
  const receipt = await f.staff.query(api.prepublicationReports.getForStaff, result);
  expect(receipt).toMatchObject({
    attemptId: f.ids.attemptId,
    claimId: "claim-fixture",
    reportUrl: expect.any(String),
  });
  expect(await (await f.post()).json()).toEqual(result);
  expect(await f.t.run((ctx) => ctx.db.get(f.ids.attemptId))).toEqual(before);
  expect(
    (await f.t.run((ctx) => ctx.db.get(f.ids.versionId)))?.scannerReportsStorageId,
  ).toBeUndefined();
  expect(
    await f.t.run(async (ctx) =>
      JSON.parse(await (await ctx.storage.get(receipt!.storageId))!.text()),
    ),
  ).toEqual(f.envelope);
});

it("denies anonymous and publisher retrieval while allowing active staff only", async () => {
  const f = await fixture();
  const result = await (await f.post()).json();
  await expect(f.t.query(api.prepublicationReports.getForStaff, result)).rejects.toThrow(
    "Unauthorized",
  );
  await expect(
    f.t
      .withIdentity({ subject: `${f.ids.ownerId}|session` })
      .query(api.prepublicationReports.getForStaff, result),
  ).rejects.toThrow("Forbidden");
  await f.t.run((ctx) => ctx.db.patch(f.ids.staffId, { deactivatedAt: Date.now() }));
  await expect(f.staff.query(api.prepublicationReports.getForStaff, result)).rejects.toThrow(
    "User not found",
  );
});

it("rejects foreign worker/claim/artifact identities and expired claims without changing the lease", async () => {
  const f = await fixture();
  const before = await f.t.run((ctx) => ctx.db.get(f.ids.attemptId));
  expect((await f.post(undefined, { token: "foreign" })).status).toBe(401);
  expect((await f.post(undefined, { headers: { "X-ClawHub-Claim-Id": "foreign" } })).status).toBe(
    409,
  );
  expect(
    (await f.post(undefined, { headers: { "X-ClawHub-Artifact-Fingerprint": "f".repeat(64) } }))
      .status,
  ).toBe(409);
  expect(await f.t.run((ctx) => ctx.db.get(f.ids.attemptId))).toEqual(before);
  await f.t.run((ctx) => ctx.db.patch(f.ids.attemptId, { checkClaimExpiresAt: Date.now() - 1 }));
  expect((await f.post()).status).toBe(409);
  expect(await f.t.run((ctx) => ctx.db.system.query("_storage").collect())).toEqual([]);
});

it("never adopts or deletes a caller-selected fresh global blob, including matching report bytes", async () => {
  const f = await fixture();
  const foreign = await f.t.run((ctx) =>
    ctx.storage.store(new Blob([JSON.stringify(f.envelope)], { type: "application/json" })),
  );
  expect((await f.post({ ...f.envelope, storageId: foreign })).status).toBe(400);
  expect(await f.t.run(async (ctx) => Boolean(await ctx.storage.get(foreign)))).toBe(true);
  const result = await (await f.post()).json();
  expect((await f.staff.query(api.prepublicationReports.getForStaff, result))!.storageId).not.toBe(
    foreign,
  );
  expect(await f.t.run(async (ctx) => Boolean(await ctx.storage.get(foreign)))).toBe(true);
});

it("deduplicates repeated delivery and preserves late idempotent delivery", async () => {
  const f = await fixture();
  const responses = [await f.post(), await f.post()];
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  const first = await responses[0].json();
  expect(await responses[1].json()).toEqual(first);
  expect(await f.t.run((ctx) => ctx.db.query("auditLogs").collect())).toHaveLength(1);
  expect(await f.t.run((ctx) => ctx.db.system.query("_storage").collect())).toHaveLength(1);
  await f.t.run((ctx) =>
    ctx.db.patch(f.ids.attemptId, {
      status: "finalized",
      checkClaimId: undefined,
      checkClaimExpiresAt: undefined,
    }),
  );
  expect(await (await f.post()).json()).toEqual(first);
  expect(
    (await f.post({ ...f.envelope, execution: { ...f.envelope.execution, stdout: "changed" } }))
      .status,
  ).toBe(409);
});

it("keeps every claim occurrence available after the staged attempt expires", async () => {
  const f = await fixture();
  const first = await (await f.post()).json();
  await f.t.run((ctx) => ctx.db.patch(f.ids.attemptId, { checkClaimId: "next-claim" }));
  const second = await (
    await f.post({ ...f.envelope, attempt: { ...f.envelope.attempt, claimId: "next-claim" } })
  ).json();
  expect(second.receiptId).not.toBe(first.receiptId);
  await f.t.run((ctx) => ctx.db.delete(f.ids.attemptId));
  expect(await f.staff.query(api.prepublicationReports.getForStaff, first)).toMatchObject({
    claimId: "claim-fixture",
    reportUrl: expect.any(String),
  });
  expect(await f.staff.query(api.prepublicationReports.getForStaff, second)).toMatchObject({
    claimId: "next-claim",
    reportUrl: expect.any(String),
  });
});

it.each(["mime", "malformed", "oversized", "hash"])(
  "rejects %s input before storing any private blob",
  async (invalid) => {
    const f = await fixture();
    const response = await f.post(
      f.envelope,
      invalid === "mime"
        ? { contentType: "text/plain" }
        : invalid === "malformed"
          ? { body: "{" }
          : invalid === "oversized"
            ? { body: " ".repeat(16 * 1024 * 1024 + 1) }
            : { headers: { "X-ClawHub-Report-SHA256": "0".repeat(64) } },
    );
    expect(response.status).toBe(invalid === "oversized" ? 413 : 400);
    expect(await f.t.run((ctx) => ctx.db.system.query("_storage").collect())).toEqual([]);
    expect(await f.t.run((ctx) => ctx.db.query("auditLogs").collect())).toEqual([]);
  },
);

it.each(["partial", "failed", "completed"])(
  "retains complete %s native reports and judgments outside bounded summaries",
  async (status) => {
    const f = await fixture();
    const native = JSON.stringify({
      schemaVersion: "clawscan-run-v1",
      profile: "clawhub",
      scanners: {
        skillspector: {
          status,
          raw: {
            issues: Array.from({ length: 30 }, (_, index) => ({
              evidence: `private-finding-${index}`,
            })),
            evidence:
              status === "partial" ? "private-raw-evidence".repeat(70_000) : "private-raw-evidence",
          },
        },
      },
      judge: {
        status: status === "failed" ? "error" : "completed",
        result: { verdict: "suspicious" },
      },
    });
    const report = {
      ...f.envelope,
      execution: {
        ...f.envelope.execution,
        exitCode: status === "failed" ? 1 : 0,
        artifact: {
          presence: "present",
          encoding: "base64",
          content: btoa(native),
          bytes: new TextEncoder().encode(native).byteLength,
          sha256: await digest(native),
        },
      },
      projections: {
        check: { status: status === "failed" ? "failed" : "clean" },
        analysis: { status: "suspicious", verdict: "suspicious" },
        skillSpectorAnalysis: {
          inspectionStatus: status,
          issueCount: 30,
          issues: Array.from({ length: 25 }, (_, index) => ({ finding: `bounded-${index}` })),
        },
      },
    };
    const response = await f.post(report);
    expect(response.status).toBe(200);
    const result = await response.json();
    const receipt = await f.staff.query(api.prepublicationReports.getForStaff, result);
    const retained = await f.t.run(async (ctx) =>
      JSON.parse(await (await ctx.storage.get(receipt!.storageId))!.text()),
    );
    expect(retained).toEqual(report);
    expect(
      JSON.parse(atob(retained.execution.artifact.content)).scanners.skillspector.raw.issues,
    ).toHaveLength(30);
    expect(
      JSON.stringify(await f.t.run((ctx) => ctx.db.get(result.receiptId))).length,
    ).toBeLessThan(4096);
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.ids.versionId)))?.scannerReportsStorageId,
    ).toBeUndefined();
  },
);

it.each(["manifest", "nativeHash", "nativePresence", "timing"])(
  "rejects mismatched %s evidence without storing it",
  async (invalid) => {
    const f = await fixture();
    const report = structuredClone(f.envelope);
    if (invalid === "manifest")
      report.attempt.files = [{ path: "SKILL.md", size: 1, sha256: "d".repeat(64) }] as never;
    if (invalid === "nativeHash")
      report.execution.artifact = {
        presence: "present",
        encoding: "base64",
        content: btoa("native"),
        bytes: 6,
        sha256: "d".repeat(64),
      } as never;
    if (invalid === "nativePresence") report.execution.artifact.presence = "present";
    if (invalid === "timing") report.execution.completedAt = 0;
    expect((await f.post(report)).status).toBe(400);
    expect(await f.t.run((ctx) => ctx.db.system.query("_storage").collect())).toEqual([]);
  },
);

it.each([
  "claim-race",
  "committed-timeout",
  "unavailable-readback",
  "duplicate-winner",
  "store-failed",
])(
  "cleans only its fresh blob after %s and preserves uncertain committed evidence",
  async (outcome) => {
    const { retainHttp } = await import("./prepublicationReports");
    const f = await fixture();
    const attempt = await f.t.run((ctx) => ctx.db.get(f.ids.attemptId));
    const runQuery = vi.fn().mockResolvedValueOnce({ receiptId: null, attempt });
    if (outcome === "unavailable-readback")
      runQuery.mockRejectedValueOnce(new Error("unavailable"));
    else
      runQuery.mockResolvedValueOnce(
        outcome === "committed-timeout"
          ? { _id: "accepted-receipt", metadata: { storageId: "server-created" } }
          : null,
      );
    const store = vi.fn().mockResolvedValue("server-created");
    if (outcome === "store-failed") store.mockRejectedValueOnce(new Error("unavailable"));
    const remove = vi.fn().mockResolvedValue(undefined);
    const runMutation =
      outcome === "duplicate-winner"
        ? vi.fn().mockResolvedValue({ receiptId: "winner-receipt", storageId: "winner-created" })
        : vi.fn().mockRejectedValue(new Error("claim changed or mutation result unknown"));
    const body = JSON.stringify(f.envelope);
    const handler = retainHttp as unknown as {
      _handler: (ctx: unknown, request: Request) => Promise<Response>;
    };
    const response = await handler._handler(
      { runQuery, runMutation, storage: { store, delete: remove } },
      new Request("http://fixture.invalid/api/internal/prepublication-reports", {
        method: "POST",
        body,
        headers: {
          Authorization: "Bearer report-fixture-token",
          "Content-Type": "application/json",
          "X-ClawHub-Attempt-Id": f.ids.attemptId,
          "X-ClawHub-Claim-Id": "claim-fixture",
          "X-ClawHub-Artifact-Fingerprint": "a".repeat(64),
          "X-ClawHub-Report-SHA256": await digest(body),
        },
      }),
    );
    expect(response.status).toBe(
      ["committed-timeout", "duplicate-winner"].includes(outcome) ? 200 : 503,
    );
    if (["claim-race", "duplicate-winner"].includes(outcome))
      expect(remove).toHaveBeenCalledExactlyOnceWith("server-created");
    else expect(remove).not.toHaveBeenCalled();
  },
);
