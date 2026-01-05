# Changelog

## 0.0.4 - Unreleased

### Added
- Web: `/skills` list view with sorting (newest/downloads/stars/name) + quick filter.
- Web: admin/moderator highlight toggle on skill detail.

### Fixed
- Web: skill detail shows a loading state instead of flashing "Skill not found".
- Web: user profile shows avatar + loading state (no "User not found" flash).

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
- CLI package: bundle schema internally (no external `clawdhub-schema` publish).
- Repo: mark `clawdhub-schema` as private to prevent publishing.

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
