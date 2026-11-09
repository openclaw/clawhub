import { z } from "zod";

export const MAX_PREPUBLICATION_REPORT_BYTES = 16 * 1024 * 1024;
export const PREPUBLICATION_REPORT_ACTION = "publish_attempt.scanner_report_retained";
export const PREPUBLICATION_REPORT_TARGET = "publishAttemptScan";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z
  .string()
  .regex(/^[a-f0-9]{40}$/)
  .nullable();
const text = z.string().max(MAX_PREPUBLICATION_REPORT_BYTES);
const check = z
  .object({
    status: z.enum(["clean", "blocked", "failed"]),
    summary: z.string().optional(),
    redactedFindings: z.array(z.string()).optional(),
  })
  .strict();

export const prepublicationReportSchema = z
  .object({
    schemaVersion: z.literal("clawhub-prepublication-execution-v1"),
    attempt: z
      .object({
        id: z.string(),
        claimId: z.string().min(1).max(128),
        artifactFingerprint: hash,
        kind: z.enum(["skill", "package"]),
        slug: z.string(),
        version: z.string(),
        files: z
          .array(
            z
              .object({ path: z.string(), size: z.number().int().nonnegative(), sha256: hash })
              .strict(),
          )
          .max(8192),
      })
      .strict(),
    source: z
      .object({
        workerId: z.string().max(200).nullable(),
        workerRevision: revision,
        githubRunId: z.string().regex(/^\d+$/).nullable(),
        githubRunAttempt: z.string().regex(/^\d+$/).nullable(),
        configuredClawscanSourceCommit: revision,
        nodeVersion: z.string().max(100),
        platform: z.string().max(40),
        arch: z.string().max(40),
      })
      .strict(),
    execution: z
      .object({
        startedAt: z.number().finite().nonnegative(),
        completedAt: z.number().finite().nonnegative(),
        exitCode: z.number().int().nullable(),
        stdout: text,
        stderr: text,
        failure: z.object({ name: z.string(), message: text }).strict().nullable(),
        artifact: z
          .object({
            presence: z.enum(["missing", "unreadable", "malformed", "invalid_schema", "present"]),
            encoding: z.literal("base64"),
            content: text.nullable(),
            bytes: z.number().int().nonnegative().nullable(),
            sha256: hash.nullable(),
          })
          .strict(),
      })
      .strict(),
    projections: z
      .object({
        check,
        analysis: z.unknown().optional(),
        aigAnalysis: z.unknown().optional(),
        skillSpectorAnalysis: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();

export type PrepublicationReport = z.infer<typeof prepublicationReportSchema>;

export async function reportContentHash(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
