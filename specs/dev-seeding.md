---
summary: "Local development fixture seeding ownership rules."
read_when:
  - Working on local seed data
  - Editing dashboard empty states
  - Changing devSeed fixtures
---

# Dev Seeding

Local fixture seeding is command-driven by default:

- Worktree dev startup (`bun run dev:worktree`) seeds shared catalog fixtures under `@local`,
  including skill, plugin, scanner, and moderation fixtures, before starting the local app when
  `VITE_CONVEX_URL` points at local Convex and `CONVEX_DEPLOYMENT` is an anonymous/local deployment
  marker. It also imports the committed public corpus, refreshes cached global stats, and writes
  `.codex/runtime/dev-worktree.seeded` so routine restarts skip the expensive corpus pass. This is
  the documented first-run local setup path.
- CLI seeding (`bun run seed:dev`) runs the same seed path manually without starting the preview and
  bypasses the first-run sentinel.
- `bun run seed` is the shared seed pipeline used after local setup and by disposable PR previews.
  It installs the same moderation fixtures and committed public corpus, creates deterministic
  catalog presentation fixtures, then refreshes global stats. The presentation pass creates 16
  synthetic official organizations with real corpus-backed skills and plugins; the first eight of
  each type are highlighted so Featured and Official creators render in local and PR previews.
  Without `--preview-name` it accepts only a local Convex deployment; remote use requires an
  explicit preview name plus a Convex Preview deploy key. Vercel recreates that preview deployment
  before invoking the shared seed, so the corpus import does not perform a destructive reset.
- `bun run seed:public-corpus` is the lower-level corpus-only import command. Use it for corpus
  fixture work, not as the default local setup command. The importer keeps each dummy owner's
  batches serialized while running different owners concurrently, so owner creation remains
  deterministic without paying one network round trip per corpus row.
- `bun run validate:public-corpus` validates the committed public corpus fixture without seeding.
- `bun run seed:test` targets only the permanent `academic-chihuahua-392` ClawHub Test deployment.
  It applies the deterministic moderation fixture overlay without importing the local/public corpus,
  cloning a current user, or resetting production-derived staging rows. The Convex action also
  requires `CLAWHUB_ENV=test`, `CLAWHUB_DISABLE_CRONS=1`, and
  `CLAWHUB_DEPLOYMENT_NAME=academic-chihuahua-392`.
- `bun run seed:test:import-snapshot -- --snapshot <sanitized.zip>` is the destructive one-time
  baseline restore. It validates the archive, refuses every deployment except
  `academic-chihuahua-392`, and uses Convex `--replace-all` so cross-project table IDs restore
  correctly.
- After creating a read-only production snapshot with `bunx convex export --prod`, run
  `bun run seed:test:ranking-export -- --snapshot <snapshot.zip> --dataset-version
ranking-metrics-YYYY-MM-DD-vN --output <dataset.json>`. The sanitizer reads five fixed tables:
  public skills, public plugins, their daily aggregate rows, and active bookmarks used only to aggregate
  bookmark creation counts by skill/day. The emitted JSON contains no Convex ids or user, device,
  session, IP, auth, moderation, or private telemetry fields and is rejected unless it covers an
  exact 60-day window.
- Before any mutating ranking import command, dispatch `Reserve Test` from exact current `main` with
  the dataset version and expected SHA. Wait for it to enter `in_progress`, pass its run ID as
  `--lane-run-id`, and cancel the reservation only after import, proof, and any cleanup or rollback
  are complete. The reservation is read-only and shares the `deploy-test` concurrency group, so a
  Test deploy cannot overlap the operation.
- `bun run seed:test:ranking-import -- --dataset <dataset.json> --backup-dir <empty-dir>
--lane-run-id <run-id>` targets only `academic-chihuahua-392`. It verifies that the reservation,
  local checkout, and current `main` are the same revision, then atomically replaces the three
  ranking tables from one ZIP. Before the baseline export it sets an expiring Test-only write lock;
  skill/package daily-stat writes and the user, publisher, skill, and package identity writes used
  for re-keying fail closed while that lock is active. It preserves deterministic feature and
  skills.sh fixture rows as overlays, replaces provenance only for the matching dataset version,
  and retains older import metadata. It records version/checksum/count/time-range metadata and
  leaves an exact three-table backup. Immediately before replacement it re-exports and hashes all
  seven source and target tables and revalidates the reservation, aborting without mutation if the
  lane, lock, or tables changed. Use
  `--readback --dataset-version <version>` for
  24-hour/60-day proof, `--cleanup` with the original dataset to remove that version, or
  `--rollback --backup-dir <dir> --lane-run-id <run-id>` to restore the pre-import tables. Rollback
  also requires the current three-table state to match the exact post-operation digests recorded in
  that backup, so an older backup cannot overwrite a subsequent import or fixture change.
- `internal.devSeed.seedCurrentUserFixtures` remains a dev-only internal action for explicit local
  development tools/tests that need fixtures cloned to a local user.

Current-user fixture seeding must not be exposed as a public Convex `api` function or browser UI
action. Internal tooling may pass an `ownerUserId`, but that id must stay inside trusted local seed
tooling rather than crossing a frontend boundary. Fixture slugs and package names must include a
stable per-user seed key so multiple developers can use the same dev deployment without colliding.

Current-user fixture seeding is dev-only. It must reject production Convex deployments, and it
should not be exposed as a first-run dashboard button unless the UX and ownership rules are
intentionally revisited.

Without `OPENAI_API_KEY`, public corpus import may use zero vectors. That is
acceptable for local setup, disposable PR previews, and layout QA, but semantic search quality will
be weaker than an embedding-backed database.
