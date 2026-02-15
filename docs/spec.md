---
summary: "ClawHub spec: skills registry, versioning, vector search, moderation"
read_when:
  - Bootstrapping ClawHub
  - Implementing schema/auth/search/versioning
  - Reviewing API and upload/download flows
---

# ClawHub — product + implementation spec (v1)

## Goals

- onlycrabs.ai mode for sharing `SOUL.md` bundles (host-based entry point).
- Minimal, fast SPA for browsing and publishing agent skills.
- Skills stored in Convex (files + metadata + versions + stats).
- GitHub OAuth login; GitHub App backs up skills to `clawdbot/skills`.
- Vector-based search over skill text + metadata.
- Versioning, tags (`latest` + user tags), changelog, rollback (tag movement).
- Public read access; upload requires auth.
- Moderation: badges + comment delete; audit everything.

## Non-goals (v1)

- Paid features, private skills, or binary assets.
- GitHub App sync beyond backups (future phase).

## Core objects

### User

- `authId` (from Convex Auth provider)
- `handle` (GitHub login)
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
- `moderationVerdict`: `clean | suspicious | malicious` (normalized decision)
- `moderationReasonCodes`: `string[]` (stable machine-readable reason IDs)
- `moderationEvidence`: finding snippets (`code`, `severity`, `file`, `line`, `message`, `evidence`)
- `moderationSummary`, `moderationEngineVersion`, `moderationEvaluatedAt`, `moderationSourceVersionId`
- `hiddenAt`, `hiddenBy`, `lastReviewedAt`, `reportCount`
- `stats`: `{ downloads, stars, versions, comments }`
- `createdAt`, `updatedAt`

### SkillVersion

- `skillId`
- `version` (semver string)
- `tag` (string, optional; `latest` always maintained separately)
- `changelog` (required)
- `files`: list of file metadata
  - `path`, `size`, `storageId`, `sha256`
- `parsed` (metadata extracted from SKILL.md)
- `staticScan`: deterministic static-analysis payload (`status`, `reasonCodes`, `findings`, `summary`, `engineVersion`, `checkedAt`)
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

### Soul

- `slug` (unique)
- `displayName`
- `ownerUserId`
- `summary` (from SOUL.md frontmatter `description`)
- `latestVersionId`
- `tags` map: `{ tag -> versionId }`
- `stats`: `{ downloads, stars, versions, comments }`
- `status`: `active` only (soft-delete on version/comment only)
- `createdAt`, `updatedAt`

### SoulVersion

- `soulId`
- `version` (semver string)
- `tag` (string, optional; `latest` always maintained separately)
- `changelog` (required)
- `files`: list of file metadata (SOUL.md only)
  - `path`, `size`, `storageId`, `sha256`
- `parsed` (metadata extracted from SOUL.md)
- `vectorDocId` (if using RAG component) OR `embeddingId`
- `createdBy`, `createdAt`
- `softDeletedAt` (nullable)

### SoulComment

- `soulId`, `userId`, `body`
- `softDeletedAt`, `deletedBy`
- `createdAt`

### SoulStar

- `soulId`, `userId`, `createdAt`

### Comment

- `skillId`, `userId`, `body`
- `softDeletedAt`, `deletedBy`
- `createdAt`

### Star

- `skillId`, `userId`, `createdAt`

### AuditLog

- `actorUserId`
- `action` (enum: `badge.set`, `badge.unset`, `comment.delete`, `role.change`)
- `targetType` / `targetId`
- `metadata` (json)
- `createdAt`

## Auth + roles

- Convex Auth with GitHub OAuth App.
- Default role `user`; bootstrap `steipete` to `admin` on first login.
- Management console: moderators can hide/restore skills + mark duplicates + ban users; admins can change owners, approve badges, hard-delete skills, and ban users (deletes owned skills).
- Role changes are admin-only and audited.
- Reporting: any user can report skills; per-user cap 20 active reports; skills auto-hide after >3 unique reports (mods can review/unhide/delete/ban).

## Upload flow (50MB per version)

1. Client requests upload session.
2. Client uploads each file via Convex upload URLs (no binaries, text only).
3. Client submits metadata + file list + changelog + version + tags.
4. Server validates:
   - total size ≤ 50MB
   - file extensions/text content
   - SKILL.md exists and frontmatter parseable
   - version uniqueness
   - GitHub account age ≥ 7 days
5. Server stores files + metadata, sets `latest` tag, updates stats.

Soul upload flow: same as skills (including GitHub account age checks), but only `SOUL.md` is allowed.
Seed data lives in `convex/seed.ts` for local dev.

## Versioning + tags

- Each upload is a new `SkillVersion`.
- `latest` tag always points to most recent version unless user re-tags.
- Rollback: move `latest` (and optionally other tags) to an older version.
- Changelog is optional.

## Search

- Vector search over: SKILL.md + other text files + metadata summary (souls index SOUL.md).
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

- Env vars: Convex deployment URLs + GitHub OAuth client + OpenAI key (if used) + GitHub App backup credentials.
- SPA feel: client-side transitions, prefetching, optimistic UI.

## Open questions (carry forward)

- Embeddings provider key + rate limits.
- Zip generation memory limits (optimize with streaming if needed).
- GitHub App repo sync (phase 2).
