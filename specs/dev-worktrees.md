---
summary: "Disposable Worktrunk/Codex worktree lifecycle contract."
read_when:
  - Editing worktree setup or dev scripts
  - Changing .config/wt.toml or .worktreeinclude
  - Updating contributor setup for local Convex
---

# Dev Worktrees

Disposable worktrees are the preferred local shape for Codex sessions, parallel PR work, and short-lived branches. The Worktrunk-managed path is intentionally separate from the plain manual path:

- Manual path: `bunx convex dev --typecheck=disable` plus `bun run dev`.
- Worktree path: `bun run setup:worktree`, `bun run dev:worktree`, `wt --yes url`, and `wt --yes stop`.

## Source Of Truth

The source of truth for the worktree lifecycle is:

- `package.json` scripts for public entrypoints.
- `.config/wt.toml` for Worktrunk hooks, branch-hashed URLs, detached startup, and stop cleanup.
- `.worktreeinclude` for ignored local assets Codex-managed worktrees should copy at creation time. Worktrunk also uses it through `wt step copy-ignored` when possible.
- `scripts/setup-worktree.ts` for copied local state validation and fallback symlinking.
- `scripts/dev-worktree.ts` for detached app startup, local Convex reachability, and seeding.

`.codex/environments/environment.toml` is Codex app configuration. It can expose convenient actions, but it is not the source of truth for the developer workflow. Update it only when the corresponding package script or worktree contract changes.

## Environment Contract

Fresh Codex-managed worktrees should receive `.env.local`, `.convex/`, and `node_modules/` through `.worktreeinclude`. `setup:worktree` must then validate the copied `.env.local` and `.convex` state. If copied state is missing or incomplete, it may link missing state from a coherent source worktree as a fallback. A source is coherent when it has `.env.local` and, for `local:` Convex deployments, a matching `.convex/local/default/config.json`.

When auto-discovery picks the wrong source, contributors should pass an explicit source:

```bash
bun run setup:worktree -- --from /path/to/source/worktree
CLAWHUB_WORKTREE_SOURCE=/path/to/source/worktree bun run setup:worktree
```

Manual setup refuses to overwrite regular local `.env.local` or `.convex/` paths unless they already match the chosen source. Use `--force` only for automated repair paths or when intentionally replacing copied stale state with links to the selected source. Use `--prefer-fallback` only for automated setup after an ignored-file copy, where a copied but stale current worktree should not win over a coherent fallback source.

The setup helper validates common local Convex mistakes before accepting copied state or linking fallback state:

- missing `CONVEX_DEPLOYMENT`
- local deployment name mismatch
- missing `VITE_CONVEX_URL` or local function port mismatch
- `VITE_CONVEX_SITE_URL` or `CONVEX_SITE_URL` missing or pointing at the wrong local site port

## Worktrunk Contract

`bun run dev:worktree` requires the `wt` executable on `PATH`. The current repo contract treats Worktrunk as mandatory for the detached worktree path and keeps the non-Worktrunk fallback as the manual path.

Worktrunk runs the configured pre-start hooks before starting the detached server. It should copy ignored files before setup validation:

```text
wt step copy-ignored || true; bun run setup:worktree -- --quiet --force --prefer-fallback
test -x node_modules/.bin/vite || bun install
```

The copy step is best effort. Codex-managed worktrees copy ignored files when they are created, and Worktrunk-created or older worktrees may still need the setup fallback. The follow-up setup step uses `--force --prefer-fallback` because a Worktrunk copy can materialize stale regular `.env.local` / `.convex/` paths before setup selects a coherent fallback source. If `.convex` is already a symlink to the source worktree, Worktrunk may report that it refused to copy `.convex` outside the destination worktree. That is acceptable as long as `setup:worktree` validates or links `.convex` and `.env.local`, and dependencies are present.

## Runtime Contract

`scripts/dev-worktree.ts` loads `.env.local`, checks `VITE_CONVEX_URL`, starts local Convex if it is not reachable, optionally seeds local fixtures plus the public corpus once when both `VITE_CONVEX_URL` and `CONVEX_DEPLOYMENT` describe a local target, then starts Vite on the requested port. Worktrunk passes `--seed` for normal `dev:worktree` startup. Detached runtime state lives under `.codex/runtime/`:

- `.codex/runtime/dev-worktree.pid`
- `.codex/runtime/dev-worktree.log`
- `.codex/runtime/dev-worktree.seeded`

Use `wt --yes stop` before removing or recreating a worktree. If a stale pid blocks startup, stop the service and inspect the runtime log before deleting files by hand.

Local worktree startup must not consume the developer's Codex account
implicitly. Workers that invoke Codex CLI, including ClawScan and Skill Card
generation, are disabled in local dev unless the process has
`CLAWHUB_ALLOW_LOCAL_CODEX_SCAN=1`; GitHub Actions workers remain allowed. When
local Codex workers are explicitly enabled, they must default to an ignored
worktree-local `CODEX_HOME` under `.codex/runtime/codex-workers/` unless the
operator provides `CODEX_HOME`.

## Seeding Contract

`bun run dev:worktree` is the documented first-run path and seeds before starting the detached app when both the Convex URL and deployment marker are local. Successful automatic seeding records the Convex deployment plus URL in `.codex/runtime/dev-worktree.seeded`, so restarts against the same local backend skip seeding. Remote-backed previews or mismatched deployment markers skip seeding and keep starting. `bun run seed:dev` uses the same worktree setup helper and the same local Convex readiness checks as the detached dev server for manual reseeding, bypasses the sentinel, and remains local-only. Lower-level Convex calls and `seed:public-corpus` are recovery or fixture-authoring tools, not the first-run path.
