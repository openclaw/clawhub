---
name: convex-retention
description: Use when adding or changing ClawHub Convex tables, TTL fields, cleanup crons, retention policy, auth/session cleanup, metric dedupe cleanup, or deprecated table removal
---

# Convex Retention

## Overview

ClawHub retention is code-owned. Every current Convex table must be classified in
`convex/lib/retentionPolicy.ts`, and ephemeral tables need an indexed, bounded cleanup path unless
their lifecycle is handled by usage-time validation or a documented component.

## Checklist

- Use `clawhub-convex` and read `convex/_generated/ai/guidelines.md` first.
- Add every new schema table to `RETENTION_POLICIES`; the `Record<TableNames, RetentionPolicy>` type
  is the enforcement gate.
- For ephemeral tables, prefer an explicit expiration field plus index, then prune with `.withIndex()`
  and `.take(...)`.
- For new generic TTL tables, prefer `expirationTime` to match Convex Auth. Keep existing `expiresAt`,
  `dayStart`, and `processedAt` fields unless that table already needs a real migration.
- Use `RETENTION_STANDARD_BATCH_SIZE` for ordinary retention jobs. Keep incident-tested special cases,
  such as `skillStatEvents`, on their documented caps.
- Cron jobs should schedule bounded cleanup entrypoints only. Large one-off production migrations or
  destructive backfills still start with `convex-migration-helper`.
- Do not bulk-clear active auth state. Expired `authSessions` and `authRefreshTokens` are pruned by
  `convex/retention.ts`.

## Verification

- Add or update focused tests for policy classification and cleanup behavior.
- Run the focused Vitest slice for touched cleanup modules.
- Run `bunx convex codegen` after schema/API changes.
- Run a real Convex runtime check such as `bunx convex dev --once --typecheck=disable`.
