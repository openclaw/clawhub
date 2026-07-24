---
summary: "ClawHub spec: skills registry, versioning, vector search, moderation"
read_when:
  - Bootstrapping ClawHub
  - Implementing schema/auth/search/versioning
  - Reviewing API and upload/download flows
---

# ClawHub — product + implementation spec (v1)

## Goals

- Minimal, fast SPA for browsing and publishing agent skills.
- Skills stored in Convex (files + metadata + versions + stats).
- GitHub OAuth login; Convex backups with file storage are the source of truth
  for hosted registry artifact disaster recovery.
- Vector-based search over skill text + metadata.
- Versioning, tags (`latest` + user tags), changelog, rollback (tag movement).
- Public read access; upload requires auth.
- Moderation: badges + report handling; audit everything.

## Non-goals (v1)

- Paid features, private skills, or binary assets.
- GitHub App sync beyond backups (future phase).

## Core objects

### User

- `authId` (from Convex Auth provider)
- `handle` (GitHub login)
- reserved org/platform handles are held separately so official account names cannot be auto-claimed by unrelated sign-ins
- `name`, `bio`
- `avatarUrl` (GitHub, fallback gravatar)
- `role`: `admin | moderator | user` (moderators can soft-delete and flag; admins can hard-delete + change owners)
- `createdAt`, `updatedAt`

### Skill

- `slug` (unique)
- `displayName`
- `ownerUserId`
- `summary` (from SKILL.md frontmatter `description`)
- `latestVersionId`
- `latestTagVersionId` (for `latest` tag)
- `tags` map: `{ tag -> versionId }`
- `badges`: `{ redactionApproved?: { byUserId, at }, highlighted?: { byUserId, at }, official?: { byUserId, at }, deprecated?: { byUserId, at } }`
  - `official` marks admin-verified/official skills.
  - `deprecated` marks skills that should not be used for new integrations.
- `moderationStatus`: `active | hidden | removed`
- `moderationFlags`: `string[]` (automatic detection)
- `moderationNotes`, `moderationReason`
- `hiddenAt`, `hiddenBy`, `lastReviewedAt`, `reportCount`
- `stats`: legacy nested compatibility counters; canonical migrated counters live
  in top-level fields.
- `statsDownloads`: native ClawHub downloads.
- `statsSkillsShInstalls`: upstream skills.sh installs, stored separately.
- `statsInstallsCurrent`, `statsInstallsAllTime`: OpenClaw install telemetry.
- `statsGithubStars`: upstream GitHub popularity.
- `statsStars`: ClawHub Bookmarks; existing `stars` rows and API names remain for
  compatibility.
- Public Downloads are `statsDownloads` for native-only skills and
  `statsDownloads + statsSkillsShInstalls` for skills.sh-indexed skills.
- Search ranking continues to use native counters rather than the combined
  presentation value.
- `createdAt`, `updatedAt`

### SkillVersion

- `skillId`
- `version` (semver string)
- `tag` (string, optional; `latest` always maintained separately)
- `changelog` (required)
- `files`: list of file metadata
  - `path`, `size`, `storageId`, `sha256`
- `parsed` (metadata extracted from SKILL.md)
- `vectorDocId` (if using RAG component) OR `embeddingId`
- `createdBy`, `createdAt`
- `softDeletedAt` (nullable)

### Parsed Skill Metadata

From SKILL.md frontmatter + AgentSkills + Clawdis extensions:

- `name`, `description`, `homepage`, `website`, `url`, `emoji`
- `metadata.clawdis`: `always`, `skillKey`, `primaryEnv`, `emoji`, `homepage`, `os`,
  `requires` (`bins`, `anyBins`, `env`, `config`), `install[]`, `nix` (`plugin`, `systems`),
  `config` (`requiredEnv`, `stateDirs`, `example`), `cliHelp` (string; `cli --help` output)
- `metadata.clawdbot`: alias of `metadata.clawdis` (preferred for nix-clawdbot plugin pointers)
  - Nix plugins are different from regular skills; they bundle the skill pack, the CLI binary, and config flags/requirements together.
  - `metadata` in frontmatter is YAML (object) preferred; legacy JSON-string accepted.

### Skill name compatibility

- The Agent Skills `name` field is a portable identifier: 1–64 lowercase
  alphanumeric or hyphen characters, matching the parent directory.
- ClawHub routes skills by `slug` and stores `displayName` as the user-facing
  catalog label. Publishing, importing, and GitHub sync must preserve that label
  instead of applying a catalog-preview limit as write validation.
- Clients should tolerate non-conforming legacy names when they can load them
  safely. ClawHub follows that compatibility model rather than blocking or
  silently renaming existing ecosystem content.
- Public catalog cards and rows may preview normalized names up to 70 characters
  and then show an ellipsis. The full stored label remains available on the
  detail page and as hover text; 70 is a presentation rule, not a storage,
  publish, API, or sync constraint.

### Bookmark

- `skillId`, `userId`, `createdAt`
- Stored in the legacy `stars` table and exposed through compatibility API
  routes named `stars`; user-facing product language is Bookmark.

### AuditLog

- `actorUserId`
- `action` (enum: `badge.set`, `badge.unset`, `role.change`)
- `targetType` / `targetId`
- `metadata` (json)
- `createdAt`

## Auth + roles

- Convex Auth with GitHub OAuth App.
- Default role `user`; bootstrap `steipete` to `admin` on first login.
- Management console: moderators can hide/restore skills + mark duplicates + ban users; admins can change owners, approve badges, hard-delete skills, and ban users (deletes owned skills).
- Role changes are admin-only and audited.
- Reporting: any user can report skills; per-user cap 20 active reports; skill targets auto-hide after >3 unique reports (mods can review/unhide/delete/ban).

## Upload flow (50MB per version)

1. Client requests upload session.
2. Client uploads each bounded regular file via Convex upload URLs.
3. Client submits metadata + file list + changelog + version + tags.
4. Server validates:
   - total size ≤ 50MB
   - path and size limits
   - SKILL.md exists and frontmatter parseable
   - version uniqueness
   - GitHub account age ≥ 14 days
5. Server stores files + metadata, sets `latest` tag, updates stats.

Local fixture data lives in `convex/devSeed.ts` and `fixtures/public-corpus/`.

## Versioning + tags

- Each upload is a new `SkillVersion`.
- `latest` tag always points to most recent version unless user re-tags.
- Rollback: move `latest` (and optionally other tags) to an older version.
- Changelog is optional.

## Search

- Vector search over: SKILL.md + other text files + metadata summary.
- Convex embeddings + vector index.
- Filters: tag, owner, `redactionApproved` only, min stars, updatedAt.

## Download API

- JSON API for skill metadata + versions.
- Download endpoint returns zip of a version (HTTP action).
- Soft-delete versions; downloads remain for non-deleted versions only.

## UI (SPA)

- Home: search + filters + trending/featured + “Highlighted” badge.
- Skill detail: README render, files list, version history, tags, stats, badges.
- Upload/edit: file picker + version + tag + changelog.
- Account settings: name + delete account (permanent, non-recoverable; published skills stay public).
- Admin: user role management + badge approvals + audit log.

## Testing + quality

- Vitest 4 with >=70% global coverage.
- Lint: Biome + Oxlint (type-aware).

## Vercel

- Env vars: Convex deployment URLs + GitHub OAuth client + OpenAI key (if used).
- SPA feel: client-side transitions, prefetching, optimistic UI.

## Open questions (carry forward)

- Embeddings provider key + rate limits.
- Zip generation memory limits (optimize with streaming if needed).
- GitHub App repo sync (phase 2).
