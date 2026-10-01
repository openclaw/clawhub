---
name: clawhub-convex
description: Apply ClawHub-specific Convex conventions and route to the right managed Convex skill. Use for any change under convex/, Convex commands or deployment targeting, query performance, migrations, retention, runtime validation, or skill stat reads and writes in the ClawHub repository.
---

# ClawHub Convex

Use the managed Convex guidance for general framework behavior and this skill
for ClawHub's repository-specific boundaries.

## Start Here

1. Read `convex/_generated/ai/guidelines.md` before editing Convex code.
2. Name the target runtime before running a Convex command: `local`, `dev`, or
   `prod`. Include the exact deployment when known and whether the current
   function/schema code has already been pushed there.
3. Route to the most specific companion skill:
   - Query cost, indexes, read amplification, subscriptions, or OCC:
     `convex-performance-audit`
   - Production migration, backfill, schema narrowing, or table reshaping:
     `convex-migration-helper` and `create-and-cleanup-migration`
   - Tables, TTL fields, cleanup crons, retention, auth/session cleanup, metric
     dedupe cleanup, or deprecated table removal: `convex-retention`
   - Auth, reusable components, or setup: use the matching managed Convex skill.

Do not edit upstream-managed Convex skills to store ClawHub policy.

## Commands And Runtime Validation

- Push new or changed functions before `convex run`:
  - dev: `bunx convex dev --once`
  - prod: deploy through the workflow described by
    `clawhub-production-release`
- For a non-interactive direct production deploy when explicitly required, use
  `bunx convex deploy -y`.
- If `bunx convex run --env-file .env.local ...` returns
  `401 MissingAccessToken` after login, omit `--env-file` and target the
  deployment with `--deployment <name>` or `--prod`.
- Regenerate committed API/types with `bunx convex codegen` after Convex
  API/schema changes.
- Import mutations from `convex/functions.ts`, not
  `convex/_generated/server`, so ClawHub's trigger wrapper runs. Type imports
  can still come from `convex/_generated/server`.
- Do not disable typechecking for an ordinary direct deploy. The production
  workflow owns its explicit deploy behavior and exceptions.

Mocked `ctx` tests cover pure business logic only. When behavior depends on
pagination, indexes, validators, auth identity, internal/public boundaries,
schedulers, actions calling functions, HTTP actions, storage, or OCC, also run
a real Convex path such as:

- `bunx convex dev --once`
- `bunx convex run ...`
- an HTTP action smoke
- `bun run test:pw:local-auth`

Tests that invoke a mutation through `._handler` need a mock database with
`normalizeId: vi.fn()` for trigger-wrapper compatibility.

## ClawHub Migration Boundaries

- Default production data changes to `@convex-dev/migrations`; the companion
  skills own batching, dry runs, resume/progress, confirmation, validation, and
  cleanup.
- Put component-backed table-wide backfills in `convex/migrations.ts`.
- Put custom repairs, admin-gated operations, and incident-specific workflows
  in `convex/maintenance.ts`.
- Keep one-off operator migration runs out of `.github/workflows/deploy.yml`.
- Remove temporary migration functions in a follow-up PR after production
  apply and verification unless they are intentionally retained as maintenance
  tooling.

## Query And Bandwidth Work

Use `convex-performance-audit` for the detailed rules on indexes, bounded reads,
denormalization, digest tables, subscriptions, and function limits. Before
writing or reviewing a performance-sensitive query, check deployment health
when available:

```bash
bunx convex insights --details
bunx convex logs --failure
```

Prefer measured runtime signals over speculative restructuring.

## ClawHub Hot-Path Conventions

Use `convex-performance-audit` for the complete workflow. Preserve these
ClawHub-specific implementations when touching their paths:

- Public listing and browse pages use one-shot `ConvexHttpClient.query()` reads
  unless the user needs live updates.
- When a `skillSearchDigest` row exists, resolve owner data with
  `digestToOwnerInfo(digest)`. Do not re-read the owner document when the
  digest already contains the required owner fields.
- Keep denormalized tables synchronized through the existing
  `convex-helpers` triggers and skip writes when derived fields did not change.
- Paginate computed search results client-side after running the scoring
  pipeline once; do not rerun the full vector, lexical, and popularity pipeline
  for each page.
- Add `delayMs` between backfill batches that update reactively subscribed
  tables.
- Split mutations that would read more than the transaction budget through the
  existing action-query-mutation pattern.

## Skill Stat Contract

The `skills` table still has a compatibility shape for four migrated stats:

| Legacy nested field     | Top-level source of truth |
| ----------------------- | ------------------------- |
| `stats.downloads`       | `statsDownloads`          |
| `stats.stars`           | `statsStars`              |
| `stats.installsCurrent` | `statsInstallsCurrent`    |
| `stats.installsAllTime` | `statsInstallsAllTime`    |

- Read these fields with `readCanonicalStat()` from
  `convex/lib/skillStats.ts`. It prefers the top-level field and falls back for
  pre-migration documents.
- Write deltas with `applySkillStatDeltas()`. It updates both shapes in one
  patch.
- Any direct patch touching these values must update both shapes.
- Nested-only reads remain valid for `stats.comments` and `stats.versions`.
- When adding a migrated stat field, use the same dual-write shape and add a
  cursor-based backfill.
