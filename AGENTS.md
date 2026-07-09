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

## Specialized Workflows

- For any Convex work, use
  `.agents/skills/clawhub-convex/SKILL.md`. It routes to the managed Convex
  skills and owns ClawHub-specific runtime, migration, retention, validation,
  performance, and skill-stat conventions.
- For app production deploys or stable CLI npm releases, use
  `.agents/skills/clawhub-production-release/SKILL.md`.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
