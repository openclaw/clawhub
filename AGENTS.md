# Repository Guidelines

## Project Structure & Module Organization

- `src/` — TanStack Start app code (routes, components, styles).
- `convex/` — Convex backend (schema, queries/mutations/actions, HTTP routes).
- `convex/_generated/` — generated Convex API/types; committed for builds.
- `docs/` — publishable public/operator docs for the ClawHub docs tab.
- `specs/` — product specs, plans, regression notes, design history (see `specs/spec.md`).
- `public/` — static assets.

## Durable Intent & Specs

- Use `specs/` to persist system/subsystem intent, invariants, and design rationale that future agents should preserve.
- Keep intended behavior for security-sensitive flows there, especially moderation, upload gating, scanner outcomes, appeals, bans, ownership, package installability, and API trust boundaries.
- If code changes reveal or change how a subsystem is supposed to work, update the relevant spec or add a focused spec note instead of burying the intent only in PR text or public docs.
- Keep `docs/` user/operator-facing: explain current behavior and commands there, but put internal “why this must work this way” context in `specs/`.

## Build, Test, and Development Commands

Keep this section as the command map agents normally need, not a full `package.json` script index.

- `bun run dev` — foreground local app server at `http://localhost:3000`.
- `bunx convex dev --typecheck=disable` — local Convex backend/function watcher for manual setup.
- `bunx convex codegen` — regenerate `convex/_generated` after Convex API/schema changes.
- `.worktreeinclude` — Codex-managed worktrees copy ignored local state (`.env.local`, `.convex/`, and `node_modules/`) from the local checkout at creation time.
- `bun run setup:worktree` — validate copied `.env.local` / `.convex` state, or link missing fallback state from a usable source worktree. Use `-- --from <path>` or `CLAWHUB_WORKTREE_SOURCE=<path>` when auto-discovery picks the wrong source.
- `bun run dev:worktree` — Worktrunk-managed detached worktree server that also seeds local fixtures plus the public corpus once before starting the app when `VITE_CONVEX_URL` and `CONVEX_DEPLOYMENT` are local. Requires `wt` on `PATH`; from that worktree use `wt --yes url` to print the branch URL and `wt --yes stop` to stop it.
- `bun run seed:dev` — manual reseed path; runs worktree setup, waits for local Convex, seeds local fixtures plus the public corpus, and refreshes stats.
- `bun run build` — production build (Vite + Nitro).
- `bun run ci:static` — required pre-handoff static gate: peer checks, audit, formatting, lint, and dead-code checks.
- `bun run ci:unit` — Vitest coverage gate; required for source/test PRs unless docs/config-only.
- `bun run ci:types-build` — full TypeScript/build gate for app, Convex, and packages.
- `bun run ci:packages` — schema, CLI, and moderation package verification.
- `bun run ci:e2e-http` — secretless HTTP and CLI e2e subset.
- `bun run ci:playwright-smoke` — chromium smoke against the public read backend.
- `bun run test:pw:local-auth` — local Convex/dev-auth browser gate for signed-in/write flows.

Specialized corpus, scanner, security-worker, UI proof, proof publishing, Crabbox, docs-authoring, and dataset scripts are real maintenance tools, but they should stay in the relevant specs, skills, or package script lookup unless the task touches that subsystem.

## Coding Style & Naming Conventions

- TypeScript strict; ESM.
- Indentation: 2 spaces, single quotes (Biome).
- Lint/format: Biome + oxlint (type-aware).
- Convex function names: verb-first (`getBySlug`, `publishVersion`).
- Inline code comments: add brief comments for tricky, bug-prone, or previously buggy logic.

## Testing Guidelines

- Framework: Vitest 4 + jsdom.
- Tests live in `src/**` and `convex/lib/**`.
- Coverage threshold: 80% global (lines/functions/branches/statements).
- Example: `convex/lib/skills.test.ts`.
- When adding or changing Convex functions, do not rely only on mocked `ctx` tests for behavior that depends on Convex runtime semantics such as pagination, indexes, validators, auth identity, internal/public function boundaries, scheduler/cron behavior, actions calling queries/mutations, HTTP actions, storage, or OCC/transaction behavior. Add or run a real Convex validation path, such as `convex dev --once`, `convex run`, an HTTP action smoke, or a local-auth Playwright flow, covering the changed behavior. Mocked `ctx.db` / `ctx.runQuery` tests are still fine for pure business logic, but they do not count as Convex runtime validation.
- For local UI state testing, prefer creating realistic backend state through seed logic plus a DevPersonaFab entry for the associated test user. Avoid one-off manual DB edits when the state is likely to be reused, such as org membership, official publisher access, moderation holds, or publishing permissions.

## Commit & Pull Request Guidelines

- Commit messages: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`…).
- Keep changes scoped; avoid repo-wide search/replace.
- Before commit/PR handoff, run `bun run ci:static` so formatting, linting, audit/peer checks, and dead-code export checks match the CI `static` job. For faster inner loops, targeted `bun run format:check -- <files>` / `bun run lint` are fine, but do not treat them as the final pre-push gate.
- Before commit/PR handoff for non-trivial code changes, use `$autoreview` until no accepted/actionable findings remain, unless equivalent manual review already happened, the change is trivial/docs-only, or the user opts out.
- Before opening a PR for source or test changes, run the targeted tests for the touched behavior and `bun run ci:unit` (`VITE_CONVEX_URL=https://example.invalid bun run coverage`) unless the change is docs/config-only or the user explicitly asks to rely on CI. For runtime, build, or package changes, also run the matching broader gate when it covers the touched surface: `bun run ci:types-build`, `bun run ci:packages`, `bun run ci:e2e-http`, or `bun run ci:playwright-smoke`.
- PRs: include summary + test commands run. Add screenshots for UI changes.
- Screenshot proof MUST come from a real running ClawHub instance in a real browser. Do not use generated HTML mockups, synthetic terminal cards, or manually composed images as proof. For route/status/backend visibility bugs, run ClawHub locally with the relevant Convex code and fixture state, capture the actual browser page, and state the local URL and fixture used.
- Before merging any PR, verify TypeScript cleanly with `bunx tsc -p packages/schema/tsconfig.json --noEmit` and `bunx tsc -p packages/clawhub/tsconfig.json --noEmit`; if Convex code changed, also run the repo typecheck path used by deploy so `bunx convex deploy` will not fail on `tsc`.
- GitHub comments: for multiline `gh` comments/close messages, use `--body-file`, `--input`, or stdin/heredoc with real newlines; never pass literal `\\n` in shell strings.
- Repo-local developer skills under `.agents/skills/` are allowed only when they are ClawHub-specific, such as Convex, moderation, PR maintainer, or UI proof workflows. Keep generic shared skills such as `crabbox` and `autoreview` in the global `agent-skills` install, not this repo. Keep top-level `skills/` reserved for installed/published skill content and ignored by git.

## Production Release

- Production deploys are manual-only. Merging to `main` does **not** deploy.
- To release production, start the GitHub Actions `Deploy` workflow from `main`:
  `gh workflow run deploy.yml --repo openclaw/clawhub --ref main`
- The workflow supports `full`, `backend`, and `frontend` targets.
- `frontend` currently means: wait for the Vercel production deploy for the selected `main` SHA, then run production smoke checks. It does not call `vercel deploy` directly yet.
- The workflow uses the GitHub `Production` environment for deploy secrets, but it does not require a separate approval step.
- Prod deploy secrets live on the `Production` environment, not as ordinary repo secrets. Required: `CONVEX_DEPLOY_KEY`. Optional: `PLAYWRIGHT_AUTH_STORAGE_STATE_JSON`.
- CLI npm releases are also manual-only and tag-based. Stable tags only: `vX.Y.Z`. Start `ClawHub CLI NPM Release` from `main`, first with `preflight_only=true`, then rerun it with the same tag and the successful `preflight_run_id`.
- Real CLI publishes wait at the GitHub `npm-release` environment and use npm trusted publishing. Required npm trusted publisher settings: repository `openclaw/clawhub`, workflow `clawhub-cli-npm-release.yml`, environment `npm-release`.

## Git Notes

- If `git branch -d/-D <branch>` is policy-blocked, delete the local ref directly: `git update-ref -d refs/heads/<branch>`.

## URL Quick Reference

- Canonical site: `https://clawhub.ai` (prefer this over legacy domains).
- Skill page URL format: `https://clawhub.ai/<owner>/<slug>` (owner handle preferred; falls back to owner id).
- Skill API detail URL: `https://clawhub.ai/api/v1/skills/<slug>`.
- Skill file URL: `https://clawhub.ai/api/v1/skills/<slug>/file?path=SKILL.md`.
- For “full URL?” requests, return the canonical page URL first, then API URL if useful.

## Configuration & Security

- Local env: `.env.local` (never commit secrets).
- Convex env holds JWT keys; Vercel only needs `VITE_CONVEX_URL` + `VITE_CONVEX_SITE_URL`.
- OAuth: GitHub OAuth App credentials required for login.

## Convex Ops (Gotchas)

- Before any `bunx convex ...` command, name the target runtime (`local`, `dev`, or `prod`), the exact deployment when known, and whether the current function/schema code has already been pushed or deployed.
- New Convex functions must be pushed before `convex run`: use `bunx convex dev --once` (dev) or `bunx convex deploy` (prod).
- For non-interactive prod deploys, use `bunx convex deploy -y` to skip confirmation.
- If `bunx convex run --env-file .env.local ...` returns `401 MissingAccessToken` despite `bunx convex login`, workaround: omit `--env-file` and use `--deployment <name>` / `--prod`.

## Convex Migrations & Backfills

- Any Convex production data migration, backfill, destructive cleanup, schema narrowing, or table reshaping must start with the `convex-migration-helper` skill. Default to `@convex-dev/migrations` for production data changes because it provides batching, dry runs, resume/progress tracking, and safer operator UX. Exceptions require an explicit note explaining why the component is unnecessary, plus equivalent dry-run support, cursor batching, resume/progress behavior, confirmation for destructive writes, and real Convex runtime validation.
- When adding or changing Convex tables, TTL fields, cleanup crons, retention policy, auth/session cleanup, metric dedupe cleanup, or deprecated table removal, use the repo-local `convex-retention` skill and update `convex/lib/retentionPolicy.ts`.
- Use `convex/migrations.ts` for component-backed table-wide backfills; keep custom repairs, admin-gated operations, and incident-specific workflows in `convex/maintenance.ts`.
- After a migration or cleanup is verified complete, remove temporary migration functions/code in a follow-up PR unless they are intentionally retained as ongoing maintenance tooling.

## Convex Query & Bandwidth Rules

- **Always use `.withIndex()` instead of `.filter()` for fields that can be indexed.** `.filter()` causes full table scans — every doc is read and billed. Even a single `.filter()` on a 16K-row table reads ~16 MB per call.
- **Convex reads entire documents** — no field projections. If you only need a few fields from large docs (~6 KB+), denormalize a lightweight summary onto the parent doc or use a lookup table (see `embeddingSkillMap`, `skill.latestVersionSummary`, `skill.badges` for examples).
- **Denormalization pattern**: persist computed fields so they can be indexed. Every mutation that updates source fields must also update the denormalized field. Always write a cursor-based backfill for new fields (see `backfillIsSuspiciousInternal`, `backfillLatestVersionSummaryInternal`, `backfillDenormalizedBadgesInternal` for examples).
- **Cron jobs must never scan entire tables.** Use indexed queries with equality filters. Use cursor-based pagination for large datasets. Prefer incremental/delta tracking over full recounts.
- **32K document limit per query.** Split `.collect()` calls by a partition field (e.g., one day at a time instead of a 7-day range). See `rebuildTrendingLeaderboardAction` in `convex/leaderboards.ts` for an example.
- **Common mistakes**: `.filter().collect()` without an index; `ctx.db.get()` on large docs in a loop for list views; while loops that paginate the whole table to find filtered results.
- **Before writing or reviewing Convex queries, check deployment health.** Run `bunx convex insights` to check for OCC conflicts, `bytesReadLimit`, and `documentsReadLimit` errors. Run `bunx convex logs --failure` to see individual error messages and stack traces. This helps identify which functions are causing bandwidth issues so you can prioritize fixes.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Stat Field Migration Rules

The `skills` table maintains two parallel sets of stat fields as part of an in-progress field migration:

| Legacy (nested, `@deprecated`) | Top-level (source of truth, indexable) |
| ------------------------------ | -------------------------------------- |
| `stats.downloads`              | `statsDownloads`                       |
| `stats.stars`                  | `statsStars`                           |
| `stats.installsCurrent`        | `statsInstallsCurrent`                 |
| `stats.installsAllTime`        | `statsInstallsAllTime`                 |

**Rules:**

- **Always use `readCanonicalStat(skill, field)` (`convex/lib/skillStats.ts`) to read** any of the four migrated fields. It prefers the top-level field and falls back to the nested field for pre-migration documents. Never access `skill.stats.downloads` / `.stars` / `.installsCurrent` / `.installsAllTime` directly.
- **Always use `applySkillStatDeltas()` to write** stat deltas. It writes both the top-level and nested fields in the same patch to keep them in sync.
- **Both sets of fields must be written together** in any patch that touches stat values (see the return shape of `applySkillStatDeltas`).
- **Nested-only reads are acceptable only for** `stats.comments` and `stats.versions` — no top-level field exists for these yet.
- The four legacy nested fields are marked `@deprecated` in `statsValidator` (schema.ts). Any IDE access to `skill.stats.downloads` etc. will show a strikethrough warning — treat this as a signal to use `readCanonicalStat()` instead.
- When adding new stat fields, follow the same dual-write pattern and add a cursor-based backfill mutation (see `backfillSkillStatFieldsInternal` for an example).
