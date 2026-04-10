# Changelog

## Unreleased

### Changed

- Search: add CJK tokenization support (Chinese/Japanese/Korean) with Intl.Segmenter plus fallback behavior to improve skill query matching (#1596) (thanks @pq-dong).

## 0.10.0 - 2026-04-05

### Added

- Design system: introduce a shared UI component library (`src/components/ui/`) built on Radix UI primitives — Button, Card, Badge, Tabs, Dialog, Input, Textarea, Label, Select, Avatar, Separator, Tooltip, ScrollArea, Sheet, Skeleton, and Table — following the shadcn/ui pattern with `cn()` + Tailwind utilities.
- Design system: `Button` supports `asChild` via Radix Slot for polymorphic rendering (e.g., wrapping `<Link>` without extra DOM).
- Layout: add `Container` component with `narrow` / `default` / `wide` size presets and `Breadcrumb` component for hierarchical navigation.
- Loading: add skeleton loading states (`SkillCardSkeleton`, `SkillDetailSkeleton`, `DashboardSkeleton`) replacing text-based "Loading..." indicators with animated placeholders.
- Errors: add `ErrorBoundary` with `resetKey` prop that auto-resets on route changes, wired into the root layout.
- Errors: surface fallback messages from Convex API error payloads in mutation/action error toasts.
- UX: add `EmptyState` component with icon, headline, description, and optional CTA action used across dashboard, stars, profile, and publish pages.
- UX: add confirmation dialogs for destructive skill ownership actions (transfer, abandon).
- Markdown: add `MarkdownPreview` component with `react-markdown`, `remark-gfm`, and `react-syntax-highlighter` for rich rendering of skill/plugin READMEs with syntax-highlighted code blocks, GFM tables, and task lists.
- Markdown: render tables with the new `Table` UI primitive for consistent styling across skill docs.
- Navigation: replace DropdownMenu-based mobile nav with a slide-out `Sheet` panel.
- Validation: add Zod schemas (`src/lib/schemas.ts`) for publish-skill, settings, report, and org forms.
- Management: restore capability-tags UI (crypto, requires-wallet, can-make-purchases, etc.) that was silently removed during the initial refactor.
- Management: add `.catch()` error handling with toast feedback on `setSoftDeleted` calls; prompt for hide/restore reasons.

### Changed

- CSS: migrate from a monolithic 5,161-line `styles.css` to Tailwind utilities on components, pruning CSS to ~1,000 lines (81% reduction). Dark mode now uses Tailwind `dark:` variants via a `@variant dark` directive bridging existing CSS custom properties.
- Tailwind: add `@theme` block mapping all CSS design tokens (`--bg`, `--surface`, `--ink`, `--accent`, `--line`, `--radius-*`, etc.) into first-class Tailwind utilities.
- Pages: modernize all route pages (home, skills browse, skill detail, dashboard, settings, publish-skill, publish-plugin, import, about, CLI auth, stars, souls, user profile, org profile, management, plugins browse, plugin detail) from CSS class selectors to Tailwind + UI primitives.
- Skills browse: widen container to `wide` (1400px) for better use of screen space on desktop; same for plugins browse.
- Skills browse: replace text-based filter toggles with pill chips and modernize toolbar layout.
- Skill detail: migrate tab controls from CSS-styled buttons to Radix `Tabs` primitive with proper `role="tab"` accessibility.
- Skill detail: replace inline CSS class-based install card with `SkillInstallCard` using Card + Button primitives.
- Header/Footer: migrate from CSS classes to Tailwind utilities with responsive Sheet-based mobile navigation.
- Dashboard: replace CSS table layout with `Table` UI primitive; add metric cards and skeleton loading.
- Settings: modernize form inputs with `Input`/`Textarea`/`Label` primitives and structured layout.
- Publish: use `Dialog` primitive for modals; inline validation indicators; modernized file list display.

### Fixed

- Auth: `EmptyState` "Sign in" button on publish page now triggers GitHub OAuth via `useAuthActions` instead of linking to non-existent `/signin` route.
- API: fix plugins page dev-mode `{"error":"Only HTML requests are supported here"}` by routing SSR and localhost API fetches directly to the Convex site URL instead of through TanStack Start's request pipeline.
- API: fix CORS error when `credentials: "include"` conflicts with `Access-Control-Allow-Origin: *` by making credentials conditional on same-origin requests.
- API: fix SSR `packageApiUrl` to always use `VITE_CONVEX_SITE_URL` directly, avoiding `getRequestUrl()` failures when SSR request context is unavailable.
- Management: restore `setSoftDeleted` reason parameter for hide/restore actions.
- Tests: rename `settings.test.tsx` to `-settings.test.tsx` to exclude from TanStack Router's file-based route discovery.
- Tests: add `@convex-dev/auth/react` mock for `useAuthActions` in upload route tests.
- Tests: update skill detail tests for Radix tab roles (`role="tab"` instead of `role="button"`), skeleton loading classes (`animate-pulse`), and capability tag data.
- Tests: update skills index tests for refreshed UI copy (placeholder text, empty state wording, loading indicator patterns).
- Tests: update SkillDiffCard tests for Tailwind active-tab class (`shadow-sm` replacing `.is-active`).
- Tests: update packages publish route tests for Tailwind border classes.
- Tests: update packageApi tests for conditional credentials and SSR URL resolution.

## 0.9.0 - 2026-03-23

### Added

- Packages/Plugins: add a first-class OpenClaw package registry across the web app, CLI, and HTTP API. ClawHub now supports package browse/search/detail/version/file/download flows plus `clawhub package explore`, `clawhub package inspect`, and `clawhub package publish` for `skill`, `code-plugin`, and `bundle-plugin` packages. (#1093)
- Packages/Install: package downloads now ship install-ready archives with a `package/` root, support nested files like `dist/index.js`, and work directly with OpenClaw plugin install flows.
- Skills/Web: server-render public skill pages and OG assets for faster first loads, cleaner sharing previews, and better cache behavior.

### Changed

- Browse/Search: rebuild public browse/search around denormalized digests, one-shot HTTP fetches, and deterministic cursors so the homepage and `/skills` are faster, more cacheable, and less likely to hit stale-tab or pagination dead ends.
- Search: default skill search to relevance, keep load-more retryable after fetch failures, and tighten package/skill catalog query paths to reduce inconsistent results under load.

### Fixed

- Packages/Auth: authenticated owners can now list, search, inspect, download, and read files from their own private packages instead of private packages being direct-URL-only. (#1093)
- Packages/API: stabilize package latest-version pointers, cursor pagination, publish outputs, fallback release resolution, and app-origin auth handling so package publish/search/install flows stay reliable.
- Visibility/API: prevent skills owned by deleted/banned users from showing up in public detail pages, browse/search results, or version API routes.
- Skills/API: sanitize public skill and soul version/file reads so hidden or invalid version data does not leak through direct API access.
- Skills/Web: keep Monaco compare layout toggles reliable while defaulting narrow screens to inline mode (#828) (thanks @geoffrey-xiao).

## 0.8.0 - 2026-03-13

### Added

- Skills/Web: show skill owner avatar + handle on skill cards, lists, and detail pages (#312) (thanks @ianalloway).
- Skills/Web: add file viewer for skill version files on detail page (#44) (thanks @regenrek).
- CLI: add `uninstall` command for skills (#241) (thanks @superlowburn).
- Skills/API/CLI: add ownership transfer workflow with request/list/accept/reject/cancel flows.
- Skills/Web/API: surface platform/architecture labels and security evaluation results in v1 + inspect views (#499, #362).
- API: add structured skill moderation responses plus `GET /api/v1/skills/{slug}/moderation` with redacted public evidence and full owner/staff detail (#334) (thanks @ArthurzKV).
- Moderation: persist structured moderation snapshots (static scan + VT/LLM merged verdict, reason codes, and evidence) on skills and versions (#333) (thanks @ArthurzKV).
- API: add scan security verification endpoint and non-suspicious filters (#820).
- Users: add `trustedPublisher` flag and admin mutations to bypass pending-scan auto-hide for trusted publishers (#298) (thanks @autogame-17).
- Moderation: add comment reporting with per-user active report caps, unique reporter/target enforcement, and auto-hide on the 4th unique report.
- Moderation: add AI-driven comment scam backfill (`commentModeration:*`) with persisted verdict/confidence/explainer metadata and strict auto-ban for `certain_scam` + `high` confidence.
- Admin: add manual unban for banned users (clears `deletedAt` + `banReason`, audit log entry). Revoked API tokens stay revoked.
- Admin: bulk restore skills from GitHub backup; reclaim squatted slugs via v1 endpoints + internal tooling (#298) (thanks @autogame-17).
- Moderation/Admin: add manual override audit tools for suspicious-skill review.
- CI/Security: add TruffleHog pull-request scanning for verified leaked credentials (#505) (thanks @akses0).

### Changed

- Skills: make published skill licensing explicit and fixed to MIT-0; require publish consent, surface no-attribution messaging in web/CLI/API, and remove per-skill license metadata.
- Skill metadata: support env vars, dependency declarations, author, and links in parsed manifest metadata + install UI (#360) (thanks @mahsumaktas).
- Rate limiting: apply authenticated quotas by user bucket (vs shared IP), emit delay-based reset headers, and improve CLI 429 guidance/retries (#412) (thanks @lc0rp).
- Skills: reserve deleted slugs for prior owners (90-day cooldown) to prevent squatting; add admin reclaim flow (#298) (thanks @autogame-17).
- Moderation: ban flow soft-deletes owned skills (reversible) and removes them from vector search (#298) (thanks @autogame-17).
- Security/docs: document comment reporting/auto-hide behavior alongside existing skill reporting rules.
- Security/moderation: add bounded explainable auto-ban reasons for scam comments and protect moderator/admin accounts from automated bans.
- Moderation: banning users now also soft-deletes their authored comments (skill + soul), including legacy cleanup on re-ban.
- Quality gate: language-aware word counting (`Intl.Segmenter`) and new `cjkChars` signal to reduce false rejects for non-Latin docs.
- Jobs: run skill stat event processing every 5 minutes (was 15).
- Deploy: add frontend/backend drift detection plus hardened production smoke/deploy checks.
- API performance: batch resolve skill/soul tags in v1 list/get endpoints (fewer action->query round-trips) (#112) (thanks @mkrokosz).
- LLM helpers: centralize OpenAI Responses text extraction for changelog/summary/eval flows (#502) (thanks @ianalloway).
- Search/listing performance: cut embedding hydration and badge read bandwidth via `embeddingSkillMap` + denormalized skill badges; shift stat-doc sync to low-frequency cron (#441) (thanks @sethconvex).
- Search/listing performance: move public browse/search hydration onto `skillSearchDigest`, add non-suspicious index paths, and split trending rebuilds to stay under Convex document limits.

### Fixed

- API: accept legacy CLI publish payloads during the v1 migration (#815).
- Auth/UI: surface OAuth callback failures in the web UI instead of swallowing them (#688).
- Skills: allow ownership healing when the previous owner was deleted/banned, and sanitize owner data in public payloads (#689, #793).
- CLI: validate explicit `install --force --version` targets before removing an existing local skill, preventing data loss when the requested version does not exist (#825) (thanks @jonathandeamer).
- Skills/Web: debounce search URL updates on `/skills` to keep typing responsive, and cancel stale pending navigations on external query changes (#587) (thanks @neeravmakwana).
- Upload: keep folder-picking enabled after page refresh by reapplying `webkitdirectory`/`directory` on the file input ref (#551) (thanks @MunemHashmi).
- CLI publish: use a longer multipart upload timeout and normalize abort rejections into proper Errors (#550) (thanks @MunemHashmi).
- CLI: forward optional auth tokens for `search` and `explore` against authenticated registries (#608) (thanks @artdaal).
- CLI: respect `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` env vars for outbound registry requests, with troubleshooting docs (#363) (thanks @kerrypotter).
- CLI: preserve registry base paths when composing API URLs for search/inspect/moderation commands (#486) (thanks @Liknox).
- CLI: show manual URL guidance when automatic browser opening is unavailable; add regression tests for opener errors (#163) (thanks @aronchick).
- API/CLI: expose skill security status in version inspect output, with schema wiring and CLI regression coverage (#362) (thanks @abutbul).
- Moderation: remove over-broad keyword flags for common auth/payment/crypto terms so legitimate skills stop tripping regex prefilters (#273) (thanks @superlowburn).
- Skills hard-delete: delete `commentReports` rows during moderation cleanup to avoid orphaned report records.
- Comments: hide entries authored by deleted/deactivated users in `comments:listBySkill`.
- Admin API: `POST /api/v1/users/reclaim` now performs non-destructive root-slug owner transfer
  (preserves existing skill versions/stats/metadata) and clears active slug reservations.
- VirusTotal: use shared AV-engine fallback verdict mapping for pending/backfill flows and keep undetected-only results pending (#591) (thanks @Shuai-DaiDai).
- Skills/listing: keep non-suspicious browse pagination on one cursor family during `isSuspicious` backfill, and re-sync stale `latestVersionSummary` metadata fields (#572) (thanks @sethconvex).
- PWA: update `manifest.json` branding so installed apps show the correct ClawHub name (#569) (thanks @Glucksberg).
- Search/tests: cover soft-deleted skill filtering in vector hydration and lexical exact-slug fallback (#552) (thanks @MunemHashmi).
- Docs/dev: fix local setup instructions for Node support, Convex env vars, frontend port, and post-seed stats refresh (#584) (thanks @jack-piplabs).
- Docs/CLI: fix `explore` flag list indentation so `--limit` renders correctly in the command reference (#601) (thanks @gandli).
- Skill metadata: parse top-level `requires.*`, `primaryEnv`, and homepage fallbacks for security review accuracy (#548) (thanks @MunemHashmi).
- Users: sync handle on ensure when GitHub login changes (#293) (thanks @christianhpoe).
- Users/Auth: throttle GitHub profile sync on login; also sync avatar when it changes (#312) (thanks @ianalloway).
- Upload gate: fetch GitHub account age by immutable account ID (prevents username swaps) (#116) (thanks @mkrokosz).
- VT fallback: activate only VT-pending hidden skills when scans are unavailable/stale; keep quality/scanner-blocked skills hidden (#300) (thanks @superlowburn).
- API: return proper status codes for delete/undelete errors (#35) (thanks @sergical).
- API: for owners, return clearer status/messages for hidden/soft-deleted skills instead of a generic 404.
- Web: allow copying OpenClaw scan summary text (thanks @borisolver, #322).
- HTTP/CORS: add preflight handler + include CORS headers on API/download errors; CLI: include auth token for owner-visible installs/updates (#146) (thanks @Grenghis-Khan).
- CLI: clarify `logout` only removes the local token; token remains valid until revoked in the web UI (#166) (thanks @aronchick).
- CLI: validate skill slugs used for filesystem operations (prevents path traversal) (#241) (thanks @superlowburn).
- Skills: keep global sorting across pagination on `/skills` (thanks @CodeBBakGoSu, #98).
- Skills: allow updating skill description/summary from frontmatter on subsequent publishes (#312) (thanks @ianalloway).
- Skills/Web: prevent filtered pagination dead-ends and loading-state flicker on `/skills`; move highlighted browse filtering into server list query (#339) (thanks @Marvae).
- Web: align `/skills` total count with public visibility and format header count (thanks @rknoche6, #76).
- Skills/Web: centralize public visibility checks and keep `globalStats` skill counts in sync incrementally; remove duplicate `/skills` default-sort fallback and share browse test mocks (thanks @rknoche6, #76).
- Moderation: clear stale `flagged.suspicious` flags when VirusTotal rescans improve to clean verdicts (#418) (thanks @Phineas1500).
- API tests: lock `Retry-After` behavior to relative-delay semantics for v1 search 429s (#421) (thanks @apoorvdarshan).
- CLI tests: assert 5xx HTTP responses still perform retry attempts before surfacing final error (#457) (thanks @YonghaoZhao722).
- GitHub import: improve storage/publish failure errors with actionable context; add regression tests for error formatting (#512) (thanks @vassiliylakhonin).

## 0.7.0 - 2026-02-16

Reconstructed from the `clawhub@0.7.0` npm publish timestamp (`2026-02-16T05:02:25Z`) and the repo version bump commit (`e352309`).

### Added

- Skills/Web: show owner avatars/handles across cards, lists, and detail pages (#312) (thanks @ianalloway).
- Skills/Web: add version file viewer on skill detail pages (#44) (thanks @regenrek).
- CLI: add `uninstall` for installed skills (#241) (thanks @superlowburn).
- Skills/Web: add non-suspicious browse filter, downloads-first browse defaults, and popular non-suspicious homepage sections.
- Web: compact-format skill and soul stats, plus split page models for skills/detail rendering.
- Skills: auto-generate missing summaries and add a resumable/self-scheduling summary backfill job.
- Moderation/Admin: add anti-spam publish caps, trust-tier quality checks, empty-skill cleanup tooling, and stronger moderator UX.

### Changed

- HTTP/CLI: centralize CORS handling and allow tokenized owner-visible reads through the CLI (#296, #297).
- API performance: batch resolve tags in v1 list/get flows to cut action-to-query round-trips (#112) (thanks @mkrokosz).
- Quality gate: add language-aware word counting and tighten spam/quarantine handling around publish flows.

### Fixed

- Skills/Web: fix initial sort wiring, keep global ordering across pagination, prevent pagination dead-ends/flicker, and harden cursor recovery (#92, #98, #339).
- CLI: normalize abort/timeout errors, secure config-file permissions, clarify logout semantics, and prefer `$HOME` for path resolution (#164, #166, #283, #286, #299).
- API: return correct delete/undelete status codes and clearer soft-delete/owner-visible error responses (#35) (thanks @sergical).
- Upload/Auth: gate publish ownership by immutable GitHub account ID and handle duplicate auth-user records safely.
- Downloads/Search: harden download dedupe/rate limiting, improve SSR host awareness, and fix homepage/search regressions under legacy data.

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
