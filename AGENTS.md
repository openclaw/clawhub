# Repository Guidelines

## Project Structure & Module Organization

- `src/` — TanStack Start app code (routes, components, styles).
- `convex/` — Convex backend (schema, queries/mutations/actions, HTTP routes).
- `convex/_generated/` — generated Convex API/types; committed for builds.
- `docs/` — product/spec docs (see `docs/spec.md`).
- `public/` — static assets.

## Build, Test, and Development Commands

- `bun run dev` — local app server at `http://localhost:3000`.
- `bun run build` — production build (Vite + Nitro).
- `bun run preview` — preview built app.
- `bunx convex dev` — Convex dev deployment + function watcher.
- `bunx convex codegen` — regenerate `convex/_generated`.
- `bun run lint` — Biome + oxlint (type-aware).
- `bun run test` — Vitest (unit tests).
- `bun run coverage` — coverage run; keep global >= 80%.

## Coding Style & Naming Conventions

- TypeScript strict; ESM.
- Indentation: 2 spaces, single quotes (Biome).
- Lint/format: Biome + oxlint (type-aware).
- Convex function names: verb-first (`getBySlug`, `publishVersion`).

## Testing Guidelines

- Framework: Vitest 4 + jsdom.
- Tests live in `src/**` and `convex/lib/**`.
- Coverage threshold: 80% global (lines/functions/branches/statements).
- Example: `convex/lib/skills.test.ts`.

## Commit & Pull Request Guidelines

- Commit messages: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`…).
- Keep changes scoped; avoid repo-wide search/replace.
- PRs: include summary + test commands run. Add screenshots for UI changes.
- Before merging any PR, verify TypeScript cleanly with `bunx tsc -p packages/schema/tsconfig.json --noEmit` and `bunx tsc -p packages/clawdhub/tsconfig.json --noEmit`; if Convex code changed, also run the repo typecheck path used by deploy so `bunx convex deploy` will not fail on `tsc`.
- GitHub comments: for multiline `gh` comments/close messages, use `--body-file`, `--input`, or stdin/heredoc with real newlines; never pass literal `\\n` in shell strings.
- Reject PRs that add skills into source code/repo content directly (for example under `skills/` or seed-only additions intended as published skills). Skills must be uploaded/published via CLI.

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

- New Convex functions must be pushed before `convex run`: use `bunx convex dev --once` (dev) or `bunx convex deploy` (prod).
- For non-interactive prod deploys, use `bunx convex deploy -y` to skip confirmation.
- If `bunx convex run --env-file .env.local ...` returns `401 MissingAccessToken` despite `bunx convex login`, workaround: omit `--env-file` and use `--deployment-name <name>` / `--prod`.

## Convex Query & Bandwidth Rules

- **Always use `.withIndex()` instead of `.filter()` for fields that can be indexed.** `.filter()` causes full table scans — every doc is read and billed. Even a single `.filter()` on a 16K-row table reads ~16 MB per call.
- **Convex reads entire documents** — no field projections. If you only need a few fields from large docs (~6 KB+), denormalize a lightweight summary onto the parent doc or use a lookup table (see `embeddingSkillMap`, `skill.latestVersionSummary`, `skill.badges` for examples).
- **Denormalization pattern**: persist computed fields so they can be indexed. Every mutation that updates source fields must also update the denormalized field. Always write a cursor-based backfill for new fields (see `backfillIsSuspiciousInternal`, `backfillLatestVersionSummaryInternal`, `backfillDenormalizedBadgesInternal` for examples).
- **Cron jobs must never scan entire tables.** Use indexed queries with equality filters. Use cursor-based pagination for large datasets. Prefer incremental/delta tracking over full recounts.
- **32K document limit per query.** Split `.collect()` calls by a partition field (e.g., one day at a time instead of a 7-day range). See `rebuildTrendingLeaderboardAction` in `convex/leaderboards.ts` for an example.
- **Common mistakes**: `.filter().collect()` without an index; `ctx.db.get()` on large docs in a loop for list views; while loops that paginate the whole table to find filtered results.
- **Before writing or reviewing Convex queries, check deployment health.** Run `bunx convex insights` to check for OCC conflicts, `bytesReadLimit`, and `documentsReadLimit` errors. Run `bunx convex logs --failure` to see individual error messages and stack traces. This helps identify which functions are causing bandwidth issues so you can prioritize fixes.
