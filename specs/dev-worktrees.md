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
- `.worktreeinclude` for ignored assets Worktrunk should copy when possible.
- `scripts/setup-worktree.ts` for ignored local state discovery and symlinking.
- `scripts/dev-worktree.ts` for detached app startup, local Convex reachability, and seeding.

`.codex/environments/environment.toml` is Codex app configuration. It can expose convenient actions, but it is not the source of truth for the developer workflow. Update it only when the corresponding package script or worktree contract changes.

## Environment Contract

`setup:worktree` must link `.env.local` and `.convex` from a coherent source worktree into the current worktree. A source is coherent when it has `.env.local` and, for `local:` Convex deployments, a matching `.convex/local/default/config.json`.

When auto-discovery picks the wrong source, contributors should pass an explicit source:

```bash
bun run setup:worktree -- --from /path/to/source/worktree
CLAWHUB_WORKTREE_SOURCE=/path/to/source/worktree bun run setup:worktree
```

The setup helper validates common local Convex mistakes before linking:

- missing `CONVEX_DEPLOYMENT`
- local deployment name mismatch
- `VITE_CONVEX_URL` port mismatch
- `VITE_CONVEX_SITE_URL` or `CONVEX_SITE_URL` missing or pointing at the wrong local site port

## Worktrunk Contract

`bun run dev:worktree` requires the `wt` executable on `PATH`. The current repo contract treats Worktrunk as mandatory for the detached worktree path and keeps the non-Worktrunk fallback as the manual path.

Worktrunk runs the configured pre-start hooks before starting the detached server:

```text
bun run setup:worktree -- --quiet
wt step copy-ignored || true; test -x node_modules/.bin/vite || bun install
```

The copy step is best effort. If `.convex` is already a symlink to the source worktree, Worktrunk may report that it refused to copy `.convex` outside the destination worktree. That is acceptable as long as `setup:worktree` linked `.convex` and `.env.local`, and dependencies are present.

## Runtime Contract

`scripts/dev-worktree.ts` loads `.env.local`, checks `VITE_CONVEX_URL`, starts local Convex if it is not reachable, then starts Vite on the requested port. Detached runtime state lives under `.codex/runtime/`:

- `.codex/runtime/dev-worktree.pid`
- `.codex/runtime/dev-worktree.log`

Use `wt --yes stop` before removing or recreating a worktree. If a stale pid blocks startup, stop the service and inspect the runtime log before deleting files by hand.

## Seeding Contract

`bun run seed:dev` uses the same worktree setup helper and the same local Convex readiness checks as the detached dev server. It must remain the documented default seed command. Lower-level Convex calls and `seed:public-corpus` are recovery or fixture-authoring tools, not the first-run path.
