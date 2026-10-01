---
name: create-and-cleanup-migration
description: Use for end-to-end ClawHub Convex production migrations, backfills, destructive cleanups, and one-off maintenance functions that must be created, validated, shipped, run, verified, then removed after completion.
---

# Create And Cleanup Migration

Drive a ClawHub Convex migration from implementation through production cleanup,
with explicit operator gates before destructive execution and before removing the
temporary migration code.

## When To Use

- A Convex production data migration, backfill, destructive cleanup, schema
  narrowing, table reshaping, or one-off maintenance function is needed.
- Temporary Convex code must be created, deployed, run, verified, and then
  removed after it is no longer useful.
- The user asks for the full lifecycle: implement migration, PR, deploy, dry run,
  apply, verify, cleanup PR, deploy cleanup.

## Required Companion Guidance

1. Start with `convex-migration-helper`.
2. Read `convex/_generated/ai/guidelines.md` before editing Convex code.
3. Default to `@convex-dev/migrations` for production data changes.
4. If not using `@convex-dev/migrations`, write down why the component is
   unnecessary and provide equivalent:
   - dry-run support
   - cursor batching
   - resumable/progress behavior
   - destructive confirmation token
   - real Convex runtime validation
5. Use `clawhub-convex` for repository-specific file placement and runtime
   targeting. Use `clawhub-production-release` for production deploy phases.

## Safety Rules

- Never run a destructive production apply step until after presenting dry-run
  results and receiving explicit user confirmation in the current thread.
- Before implementing anything, classify the requested "migration" as one of:
  code deploy, existing Convex function run, operator import/export command,
  schema narrowing, data cleanup, or cleanup-code removal. Do not invent a new
  Convex migration function when the issue or PR specifies an operator command
  such as `convex import --replace`.
- Never remove migration code until after presenting apply/verification results
  and receiving explicit user confirmation in the current thread.
- Keep production commands pointed at the explicit deployment name when known;
  do not rely on generic `--prod` if this repo's guidance says to verify the
  actual deployment.
- If the migration can affect visibility, moderation, ownership, billing,
  installability, or public API output, call that out before the apply gate.
- Preserve resume cursors, run IDs, PR URLs, deploy URLs, and final stats in the
  handoff.

## Phase 1: Design The Migration

1. Identify the intended data change and whether it is:
   - schema widen/migrate/narrow
   - field cleanup
   - table cleanup
   - ownership/relationship repair
   - recurring maintenance
2. Choose the implementation:
   - Prefer `@convex-dev/migrations` for non-trivial production data.
   - Use a hand-rolled internal function only for a clearly small or special
     case, and document the exception.
3. Define done criteria:
   - dry-run expected counts
   - apply expected counts
   - verification query/result proving no remaining targets
   - cleanup PR scope

## Phase 2: Implement

1. Add or update the Convex migration/maintenance code.
2. Include argument validators for every Convex function.
3. Include dry-run support.
4. Include batching and resume/progress state.
5. Include a confirmation token for destructive writes.
6. Keep apply logic idempotent where practical.
7. Add targeted tests for business logic and safety gates.
8. Add real Convex runtime validation for Convex semantics such as pagination,
   validators, internal/public function boundaries, scheduler behavior, and
   action/query/mutation interactions.

## Phase 3: Local Validation

Run the smallest meaningful set first, then broaden before PR handoff:

- targeted unit tests for the migration logic
- `bunx convex codegen` when Convex API/schema changed
- `bunx tsc --noEmit` or the repo's Convex deploy typecheck path
- `bun run ci:static`
- `bun run ci:unit` for source/test changes unless explicitly waived
- a real local Convex validation path, such as `bunx convex dev --once`,
  `convex run`, HTTP smoke, or local-auth Playwright, covering the changed
  Convex behavior

If local real Convex validation is blocked, record the blocker and make the PR
or deployment plan explicitly compensate with an equivalent runtime proof.

## Phase 4: PR, Review, Merge, Deploy

1. Open a focused PR containing the migration implementation.
2. Include:
   - summary
   - migration strategy
   - dry-run/apply safety gates
   - tests and runtime validation
   - cleanup plan
3. Run the repo's review/CI workflow required by `AGENTS.md`.
4. Address actionable review findings.
5. Merge only after required checks are green or the user explicitly accepts a
   documented risk.
6. Deploy the relevant production target from `main`.
7. Wait for deployment success before running the production dry run.

## Phase 5: Production Dry Run

1. Run the production dry run with bounded batch settings.
2. Resume until either:
   - `isDone: true`, or
   - a clearly documented safety cap is reached.
3. Present results to the user before apply:
   - deployment name
   - command shape
   - `dryRun`
   - `isDone`
   - done/progress fields
   - scanned/matched/patched/deleted stats
   - sample IDs
   - resume cursors if incomplete
   - known user-visible or operational implications
4. Stop and wait for explicit user confirmation before applying.

## Phase 6: Production Apply

1. Run only after explicit user confirmation of the dry-run results.
2. Use the destructive confirmation token.
3. Resume in bounded batches until complete or until a documented safety cap.
4. Present apply results:
   - patched/deleted counts
   - skipped/missing counts if tracked
   - final cursors/progress
   - any errors or partial completion
5. Run verification:
   - dry run or status command should show zero remaining targets, or
   - explain why remaining targets are expected.
6. Stop and wait for explicit user confirmation before cleanup-code removal.

## Phase 7: Cleanup PR

1. Remove temporary migration functions, tests, docs, scripts, and generated API
   entries that are no longer needed.
2. Keep durable specs/docs only if they explain lasting behavior or invariants.
3. Run targeted validation plus the repo-required gates for the touched surface.
4. Open a cleanup PR with:
   - apply results
   - verification proof
   - explanation of removed temporary code
5. Merge after checks/review.
6. Deploy the cleanup PR if removing Convex functions or schema/code that affects
   production.

## Final Handoff

Report:

- implementation PR URL and merge SHA
- production deploy run URL and deployed SHA
- dry-run result
- apply result
- verification result
- cleanup PR URL, merge SHA, and deploy run URL
- any remaining follow-up tasks or intentional retained migration code
