/* @vitest-environment node */
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { claimBatchDrainedQueue, claimPrePublicationBatch } from "./run-prepublication-worker";

const lines = vi.hoisted(() => [] as string[]);
vi.mock("../lib/workerLogger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/workerLogger")>();
  return {
    ...actual,
    createWorkerLogger: (options: Parameters<typeof actual.createWorkerLogger>[0]) =>
      actual.createWorkerLogger({
        ...options,
        name: options?.name ?? "claim-diagnostics-test",
        level: "info",
        destination: { write: (line) => lines.push(line) },
      }),
  };
});

afterEach(() => {
  lines.length = 0;
  vi.restoreAllMocks();
});

const requestId = "0123456789abcdef";
const secondRequestId = "fedcba9876543210";
const secret = "INERT_CLAIM_CREDENTIAL_DO_NOT_LOG";
const privateSource = "INERT_PRIVATE_CLAIM_PAYLOAD_DO_NOT_LOG";
const signedUrl = `https://private.invalid/blob?X-Amz-Signature=${secret}`;
const attempt = {
  attemptId: "publishAttempts:inert-claim-diagnostics" as Id<"publishAttempts">,
  claimId: "inert-claim",
  kind: "skill" as const,
  slug: "inert-claim-diagnostics",
  displayName: "Inert claim diagnostics",
  version: "1.0.0",
  artifactFingerprint: "f".repeat(64),
  createdAt: 1_700_000_000_000,
  checkClaimExpiresAt: 1_700_000_060_000,
  files: [],
};

function records() {
  return lines.map((line) => JSON.parse(line));
}

function expectSafeRecords() {
  const serialized = lines.join("");
  expect(serialized).not.toContain(secret);
  expect(serialized).not.toContain(privateSource);
  expect(serialized).not.toContain("private.invalid");
  expect(serialized).not.toContain("Authorization");
  expect(serialized).not.toContain("X-Amz-Signature");
  expect(serialized).not.toContain("rawStack");
  for (const record of records()) {
    expect(Object.keys(record).sort()).toEqual([
      "claimError",
      "event",
      "level",
      "msg",
      "service",
      "time",
    ]);
    expect(Object.keys(record.claimError).sort()).toEqual([
      "bytes",
      "class",
      "present",
      "requestId",
      "sha256",
    ]);
    expect(record).toMatchObject({
      event: "prepublication_claim_failed",
      level: 40,
      service: "prepublication-worker",
      msg: "pre-publication claim failed; continuing with successful claims",
    });
  }
}

it("retains each safe claim correlation when another claim succeeds", async () => {
  const errors = [
    new Error(
      `[CONVEX A(publishAttempts:claimPrePublicationChecks)] [Request ID: ${requestId}] Server Error\n${privateSource} Authorization: Bearer ${secret}\n${signedUrl}`,
    ),
    new Error(
      `[Request ID: ${secondRequestId}] Server Error\nArgumentValidationError ${privateSource} ${signedUrl}`,
    ),
  ];
  errors[0].stack = `rawStack ${secret} ${signedUrl}`;
  const client = {
    action: vi
      .fn()
      .mockRejectedValueOnce(errors[0])
      .mockResolvedValueOnce(attempt)
      .mockRejectedValueOnce(errors[1]),
  };
  const result = await claimPrePublicationBatch(client, secret, 3, { kind: "skill" });

  expect(result).toEqual({ attempts: [attempt], claimFailures: 2 });
  expect(client.action).toHaveBeenCalledTimes(3);
  expect(client.action.mock.calls.map(([, args]) => args.preferRetry)).toEqual([
    true,
    undefined,
    undefined,
  ]);
  expect(claimBatchDrainedQueue(result.claimFailures, result.attempts.length, 3)).toBe(false);
  expect(records()).toHaveLength(2);
  for (const [index, error] of errors.entries()) {
    expect(records()[index].claimError).toEqual({
      class: index === 0 ? "other" : "validation",
      requestId: index === 0 ? requestId : secondRequestId,
      present: true,
      bytes: Buffer.byteLength(error.message),
      sha256: createHash("sha256").update(error.message).digest("hex"),
    });
  }
  expectSafeRecords();
});

it.each([
  { name: "object payload", reason: { message: privateSource, token: secret, url: signedUrl } },
  { name: "missing rejection", reason: undefined },
  { name: "non-string rejection", reason: 42 },
  { name: "private string", reason: `${privateSource} ${secret} ${signedUrl}` },
  {
    name: "embedded request ID",
    reason: new Error(`Artifact: [Request ID: ${requestId}] ${secret}`),
  },
  { name: "invalid request ID", reason: new Error(`[Request ID: ${requestId}f] ${secret}`) },
  {
    name: "oversized error",
    reason: new Error(`[Request ID: ${requestId}] ${"x".repeat(5000)}${signedUrl}`),
  },
])("keeps unknown $name safe without changing partial batch behavior", async ({ reason }) => {
  const client = { action: vi.fn().mockRejectedValueOnce(reason).mockResolvedValueOnce(attempt) };
  await expect(claimPrePublicationBatch(client, secret, 2)).resolves.toEqual({
    attempts: [attempt],
    claimFailures: 1,
  });
  expect(records()).toHaveLength(1);
  expect(records()[0].claimError).toMatchObject({ class: "other", requestId: null });
  expectSafeRecords();
});

it("does not let a throwing error message replace a successful partial batch", async () => {
  const reason = new Error();
  Object.defineProperty(reason, "message", {
    get: () => {
      throw new Error(secret);
    },
  });
  const client = { action: vi.fn().mockRejectedValueOnce(reason).mockResolvedValueOnce(attempt) };
  await expect(claimPrePublicationBatch(client, secret, 2)).resolves.toEqual({
    attempts: [attempt],
    claimFailures: 1,
  });
  expect(records()[0].claimError).toEqual({
    class: "other",
    requestId: null,
    present: false,
    bytes: null,
    sha256: null,
  });
  expectSafeRecords();
});

it("preserves the all-failed AggregateError and its original reasons", async () => {
  const reasons = [new Error(`[Request ID: ${requestId}] ${secret}`), { payload: privateSource }];
  const client = {
    action: vi.fn().mockRejectedValueOnce(reasons[0]).mockRejectedValueOnce(reasons[1]),
  };
  const error = await claimPrePublicationBatch(client, secret, 2).catch((value: unknown) => value);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors).toEqual(reasons);
  expect((error as AggregateError).message).toBe(
    "Pre-publication claims failed without claiming work.",
  );
  expect(records()).toHaveLength(2);
  expectSafeRecords();
});
