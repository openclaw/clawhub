# Changelog

## Unreleased

### Added
- Admin: add manual unban for banned users (clears `deletedAt` + `banReason`, audit log entry). Revoked API tokens stay revoked.

### Changed
- Quality gate: language-aware word counting (`Intl.Segmenter`) and new `cjkChars` signal to reduce false rejects for non-Latin docs.
- Jobs: run skill stat event processing every 5 minutes (was 15).

### Fixed
- Users: sync handle on ensure when GitHub login changes (#293) (thanks @christianhpoe).
- API: for owners, return clearer status/messages for hidden/soft-deleted skills instead of a generic 404.
- HTTP/CORS: add preflight handler + include CORS headers on API/download errors; CLI: include auth token for owner-visible installs/updates (#146) (thanks @Grenghis-Khan).

## 0.6.1 - 2026-02-13

### Added
- Security: add LLM-based security evaluation during skill publish.
- Parsing: recognize `metadata.openclaw` frontmatter and evaluate all skill files for requirements.

### Changed
- Performance: lazy-load Monaco diff viewer on demand (thanks @alexjcm, #212).
- Search: improve recall/ranking with lexical fallback and relevance prioritization.
- Moderation UX: collapse OpenClaw analysis by default; update spacing and default reasoning model.

### Fixed
- Skills: fix initial `/skills` sort wiring so first page respects selected sort/direction (thanks @bpk9, #92).
- Search/UI: add embedding request timeout and align `/skills` toolbar + list width (thanks @GhadiSaab, #53).
- Upload gate: handle GitHub API rate limits and optional authenticated lookup token (thanks @superlowburn, #246).
- HTTP: remove `allowH2` from Undici agent to prevent `fetch failed` on Node.js 22+ (#245).
- Tests: add root `undici` dev dependency for Node E2E imports (thanks @tanujbhaud, #255).
- Downloads: add download rate limiting + per-IP/day dedupe + scheduled dedupe pruning; preserve moderation gating and deterministic zips (thanks @regenrek, #43).
- VirusTotal: fix scan sync race conditions and retry behavior in scan/backfill paths.
- Metadata: tolerate trailing commas in JSON metadata.
- Auth: allow soft-deleted users to re-authenticate on fresh login, while keeping banned users blocked (thanks @tanujbhaud, #177).
- Web: prevent horizontal overflow from long code blocks in skill pages (thanks @bewithgaurav, #183).

## 0.6.0 - 2026-02-10
### Added
- CLI/API: add `set-role` to change user roles (admin only).
- Security: quarantine skill publishes with VirusTotal scans + UI (thanks @aleph8, #130).
- Testing: add tests for badges, skillZip, uploadFiles expandDroppedItems, and ark schema error truncation.
- Moderation: add ban reasons to API/CLI and show in management UI.

### Changed
- Coverage: track `convex/lib/skillZip.ts` in coverage reports.

### Fixed
- Web: show pending-scan skills to owners without 404 (thanks @orlyjamie, #136).
- Users: backfill empty handles from name/email in ensure (thanks @adlai88, #158).
- Web: update footer branding to OpenClaw (thanks @jontsai, #122).
- Auth: restore soft-deleted users on reauth, block banned users (thanks @mkrokosz, #106).

## 0.5.0 - 2026-02-02

### Added
- Admin: ban users and delete owned skills from management console.
- Moderation: auto-hide skills after 4 unique reports; per-user report cap; moderators can ban users.
- Uploads: require GitHub accounts to be at least 7 days old for skill + soul publish/import.
- CLI: add `inspect` to fetch skill metadata/files without installing.
- CLI: add moderation commands for hide/unhide/delete and ban users.
- Management: add filters for reported skills and users.

### Changed
- Deps: update dependencies to latest available versions.
- Reporting: require reasons, show them in management console, warn about abuse bans.

### Fixed
- Bans: batch hard-delete cleanup to avoid Convex read limits on large skills.

## 0.4.0 - 2026-01-30

### Added
- Web: show published skills on user profiles (thanks @njoylab, #20).
- CLI: include ClawHub + Moltbot fallback skill roots for sync scans.
- CLI: support OpenClaw configuration files (`OPENCLAW_CONFIG_PATH` / `OPENCLAW_STATE_DIR`).

### Changed
- Brand: rebrand to ClawHub and publish CLI as `clawhub` (legacy `clawdhub` supported).
- Domain: default site/registry now `https://clawhub.ai`; `.well-known/clawhub.json` preferred.
- Theme: persist theme under `clawhub-theme` (legacy key still read).

### Fixed
- Registry: drop missing skills during search hydration (thanks @aaronn, #28).
- CLI: use path-based skill metadata lookup for updates (thanks @daveonkels, #22).
- Search: keep highlighted-only filtering and clamp vector candidates to Convex limits (thanks @aaronn, #30).

## 0.3.0 - 2026-01-19

### Added
- CLI: add `explore` command for latest updates, with limit clamping + tests/docs (thanks @jdrhyne, #14).
- CLI: `explore --json` output + new sorts (`installs`, `installsAllTime`, `trending`) and limit up to 200.
- API: `/api/v1/skills` supports installs + trending sorts (7-day installs).
- API: idempotent `POST/DELETE /api/v1/stars/{slug}` endpoints.
- Registry: trending leaderboard + daily stats backfill for installs-based sorts.

### Fixed
- Web: keep search mode navigation and state in sync (thanks @NACC96, #12).

## 0.2.0 - 2026-01-13

### Added
- Web: dynamic OG image cards for skills (name, description, version).
- CLI: auto-scan Clawdbot skill roots (per-agent workspaces, shared skills, extraDirs).
- Web: import skills from public GitHub URLs (auto-detect `SKILL.md`, smart file selection, provenance).
- Web/API: SoulHub (SOUL.md registry) with v1 endpoints and first-run auto-seed.

### Fixed
- Web: stabilize skill OG image generation on server runtimes.
- Web: prevent skill OG text overflow outside the card.
- Registry: make SoulHub auto-seed idempotent and non-user-owned.
- Registry: keep GitHub backup state + publish backups intact (thanks @joshp123, #1).
- CLI/Registry: restore fork lineage on sync + clamp bulk list queries (thanks @joshp123, #1).
- CLI: default workdir falls back to Clawdbot workspace (override with `--workdir` / `CLAWHUB_WORKDIR`).

## 0.0.6 - 2026-01-07


### Added
- API: v1 public REST endpoints with rate limits, raw file fetch, and OpenAPI spec.
- Docs: `docs/api.md` and `DEPRECATIONS.md` for the v1 cutover plan.

### Changed
- CLI: publish now uses single multipart `POST /api/v1/skills`.
- Registry: legacy `/api/*` + `/api/cli/*` marked for deprecation (kept for now).

## 0.0.5 - 2026-01-06

### Added
- Telemetry: track installs via `clawhub sync` (logged-in only), per root, with 120-day staleness.
- Skills: show current + all-time installs; sort by installs.
- Profile: private "Installed" tab with JSON export + delete telemetry controls.
- Docs: add `docs/telemetry.md` (what we track + how to opt out).
- Web: custom Open Graph image (`/og.png`) + richer OG/Twitter tags.
- Web: dashboard for managing your published skills (thanks @dbhurley!).

### Changed
- CLI: telemetry opt-out via `CLAWHUB_DISABLE_TELEMETRY=1`.
- Web: move theme picker into mobile menu.

### Fixed
- Web: handle shorthand hex colors in diff theme (thanks @dbhurley!).

## 0.0.5 - 2026-01-06

### Added
- Maintenance: admin backfill to re-parse `SKILL.md` and repair stored summaries/parsed metadata.

### Fixed
- CLI sync: ignore plural `skills.md` docs files when scanning for skills.
- Registry: parse YAML frontmatter (incl multiline `description`) and accept YAML `metadata` objects.

## 0.0.4 - 2026-01-05

### Added
- Web: `/skills` list view with sorting (newest/downloads/stars/name) + quick filter.
- Web: admin/moderator highlight toggle on skill detail.
- Web: canonical skill URLs as `/<owner>/<slug>` (legacy `/skills/<slug>` redirects).
- Web: upload auto-generates a changelog via OpenAI when left blank (marked as auto-generated).

### Fixed
- Web: skill detail shows a loading state instead of flashing "Skill not found".
- Web: user profile shows avatar + loading state (no "User not found" flash).
- Web: improved mobile responsiveness (nav menu, skill detail layout, install command overflow).
- Web: upload now unwraps folder picks so `SKILL.md` can be at the bundle root.
- Registry: cap embedding payload size to avoid model context errors.
- CLI: ignore legacy `auth.clawdhub.com` registry and prefer site discovery.

### Changed
- Web: homepage search now expands into full search mode with live results + highlighted toggle.
- CLI: sync no longer prompts for changelog; registry auto-generates when blank.

## 0.0.3 - 2026-01-04

### Added
- CLI sync: concurrency flag to limit registry checks.
- Home: install command switcher (npm/pnpm/bun).

### Changed
- CLI sync: default `--concurrency` is now 4 (was 8).
- CLI sync: replace boxed notes with plain output for long lists.

### Fixed
- CLI sync: wrap note output to avoid terminal overflow; cap list lengths.
- CLI sync: label fallback scans as fallback locations.
- CLI package: bundle schema internally (no external `clawhub-schema` publish).
- Repo: mark `clawhub-schema` as private to prevent publishing.

## 0.0.2 - 2026-01-04

### Added
- CLI: delete/undelete commands for soft-deleted skills (owner/admin).

### Fixed
- CLI sync: dedupe duplicate slugs across scan roots; skip duplicates to avoid double-publish errors.
- CLI sync: show parsing progress while hashing local skills.
- CLI sync: prompt only actionable skills; preselect all by default; list synced separately; condensed synced summary when nothing to sync.
- CLI sync: cap long status lists to avoid massive terminal boxes.
- CLI publish/sync: allow empty changelog on updates; registry accepts empty changelog for updates.
- CLI: use `--cli-version` to avoid conflict with skill `--version` flags.
- Registry: hide soft-deleted skills from search/skill/download unless restored.
- Tests: add delete/undelete coverage (unit + e2e).

## 0.0.1 - 2026-01-04

### Features
- CLI auth: login/logout/whoami; browser loopback auth; token storage; site/registry discovery; config overrides.
- CLI workflow: search, install, update (single/all), list, publish, sync (scan workdir + legacy roots), dry-run, version bumping, tags.
- Registry/API: skills + versions with semver; tags (latest + custom); changelog per version; SKILL.md frontmatter parsing; text-only validation; zip download; hash resolve; stats (downloads/stars/versions/comments).
- Web app: home (highlighted + latest), search, skill detail (README, versions, tags, stats, files), upload UI, user profiles, stars, settings (profile + API tokens + delete account).
- Social: stars + comments with moderation hooks; admin console for roles + highlighted curation.
- Search: semantic/vector search over skill content with limit/approved filters.
- Security: GitHub OAuth; role-based access (admin/moderator/user); audit logging for admin actions.
