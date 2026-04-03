# ClawHub — Project Rules

## Convex Performance Rules

- For public listing/browse pages, use `ConvexHttpClient.query()` (one-shot fetch),
  not `useQuery`/`usePaginatedQuery` (reactive subscription). Reserve reactive
  queries for data the user needs to see update in real time.
- Denormalize hot read paths into a single lightweight "digest" table. Every
  `ctx.db.get()` join adds a table to the reactive invalidation scope.
- When a `skillSearchDigest` row is available, use `digestToOwnerInfo(digest)`
  to resolve owner data. NEVER call `ctx.db.get(ownerUserId)` when digest
  owner fields (`ownerHandle`, `ownerName`, `ownerDisplayName`, `ownerImage`)
  are already present. Reading from `users` adds the entire table to the
  reactive read set and wastes bandwidth.
- Use `convex-helpers` Triggers to sync denormalized tables automatically.
  Always add change detection — skip the write if no fields actually changed.
- Use compound indexes instead of JS filtering. If you're filtering docs after
  the query, you're scanning documents you'll throw away.
- For search results scored by computed values (vector + lexical + popularity),
  fetch all results once and paginate client-side. Don't re-run the full search
  pipeline on "load more."
- Backfills on reactively-subscribed tables need `delayMs` between batches.
- Mutations that read >8 MB should use the Action → Query → Mutation pattern
  to split reads across transactions.

## Convex Conventions

- All mutations import from `convex/functions.ts` (not `convex/_generated/server`)
  to get trigger wrapping. Type imports still come from `convex/_generated/server`.
- NEVER use `--typecheck=disable` on `npx convex deploy`.
- Use `npx convex dev --once` to push functions once (not long-running watcher).

## Production Release

- Production deploys are manual-only. Merging to `main` does **not** deploy.
- Start the GitHub Actions `Deploy` workflow from `main` with `gh workflow run deploy.yml --repo openclaw/clawhub --ref main`.
- The workflow supports `full`, `backend`, and `frontend` targets.
- `frontend` currently waits for the Vercel production deploy on the selected `main` SHA and then runs smoke checks. It does not trigger Vercel directly yet.
- The workflow uses the `Production` environment for deploy secrets, but it does not wait for a separate approval.
- Required prod secret: `CONVEX_DEPLOY_KEY` on the `Production` environment. Optional smoke secret: `PLAYWRIGHT_AUTH_STORAGE_STATE_JSON`.
- CLI npm releases are manual-only and tag-based through `ClawHub CLI NPM Release`. Stable tags only: `vX.Y.Z`. Run a `preflight_only=true` pass first, then rerun with the same tag plus `preflight_run_id` for the real publish.
- Real CLI publishes wait at `npm-release` and rely on npm trusted publishing for `openclaw/clawhub` + `clawhub-cli-npm-release.yml` + `npm-release`.

## Testing

- Tests use `._handler` to call mutation handlers directly with mock `db` objects.
- Mock `db` objects MUST include `normalizeId: vi.fn()` for trigger wrapper compatibility.
