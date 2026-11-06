/* @vitest-environment node */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { processPrePublicationAttempt } from "./run-prepublication-worker";

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../lib/workerLogger", () => ({ createWorkerLogger: () => logs }));
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const requestId = "0123456789abcdef";
const privateSource = "INERT_PRIVATE_SKILL_CONTENT_DO_NOT_LOG";
const credential = "INERT_CREDENTIAL_DO_NOT_LOG";
const cases = [
  {
    name: "capacity",
    value: new Error(
      `[Request ID: ${requestId}] Server Error\nUncaught Error: CommitterFullError: Too many writes in a short period`,
    ),
    errorClass: "capacity",
    requestId,
  },
  {
    name: "claim",
    value: new Error(
      `[Request ID: ${requestId}] Server Error\nUncaught ConvexError: Publish attempt check claim is not active.`,
    ),
    errorClass: "claim",
    requestId,
  },
  {
    name: "authentication",
    value: new Error(
      `[CONVEX A(publishAttempts:completePrePublicationChecks)] [Request ID: ${requestId}] Server Error\nUncaught ConvexError: Unauthorized`,
    ),
    errorClass: "authentication",
    requestId,
  },
  {
    name: "validation",
    value: new Error("ArgumentValidationError: inert unsupported argument"),
    errorClass: "validation",
    requestId: null,
  },
  {
    name: "transport",
    value: new Error("fetch failed: ECONNRESET"),
    errorClass: "transport",
    requestId: null,
  },
  {
    name: "artifact-credentials",
    value: new Error(
      `[Request ID: ${requestId}] Server Error\n${privateSource}\nAuthorization: Bearer ${credential}\nhttps://example.invalid/SKILL.md?token=${credential}`,
    ),
    errorClass: "other",
    requestId,
  },
  {
    name: "embedded-request-id",
    value: new Error(
      `Artifact text: [Request ID: ${requestId}] ${privateSource} TOKEN=${credential}`,
    ),
    errorClass: "other",
    requestId: null,
  },
  {
    name: "oversized",
    value: new Error(`[Request ID: ${requestId}] ${privateSource}${"x".repeat(5000)}`),
    errorClass: "other",
    requestId: null,
  },
];

it.each(cases)("keeps bounded $name completion diagnostics without error text", async (entry) => {
  vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  const attempt = {
    attemptId: "publishAttempts:inert-diagnostics" as Id<"publishAttempts">,
    claimId: "inert-claim",
    kind: "skill" as const,
    slug: "inert-diagnostics",
    displayName: "Inert diagnostic fixture",
    version: "1.0.0",
    artifactFingerprint: "f".repeat(64),
    createdAt: Date.now(),
    checkClaimExpiresAt: Date.now() + 60_000,
    files: [
      { path: "SKILL.md", size: 0, sha256: "a".repeat(64), url: "https://example.invalid/inert" },
    ],
  };
  const client = { action: vi.fn().mockRejectedValue(entry.value) };
  const result = await processPrePublicationAttempt(client, "inert-not-a-real-token", attempt, {
    writeWorkspace: vi.fn().mockResolvedValue(undefined),
    runTruffleHog: vi.fn().mockResolvedValue({ status: "clean" }),
    runClawScan: vi.fn().mockResolvedValue({ check: { status: "clean" } }),
  });
  const record = logs.warn.mock.calls[0]?.[0];
  if (process.env.REPRO_OUTPUT_DIR) {
    await mkdir(process.env.REPRO_OUTPUT_DIR, { recursive: true });
    await writeFile(
      `${process.env.REPRO_OUTPUT_DIR}/producer-${entry.name}.json`,
      JSON.stringify({ result, record, deliveryCalls: client.action.mock.calls.length }, null, 2),
    );
  }
  expect(result).toEqual({ completed: false, result: undefined });
  expect(client.action).toHaveBeenCalledTimes(1);
  expect(record).toMatchObject({
    event: "prepublication_attempt_completion_failed",
    completionError: {
      class: entry.errorClass,
      requestId: entry.requestId,
      present: true,
      bytes: Buffer.byteLength(entry.value.message),
      sha256: createHash("sha256").update(entry.value.message).digest("hex"),
    },
  });
  const serialized = JSON.stringify(record);
  expect(serialized).not.toContain(privateSource);
  expect(serialized).not.toContain(credential);
  expect(serialized).not.toContain("example.invalid");
  expect(serialized).not.toContain("Authorization");
  expect(serialized.length).toBeLessThan(600);
});
