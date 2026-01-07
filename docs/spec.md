---
summary: "ClawdHub spec: skills registry, versioning, vector search, moderation"
read_when:
  - Bootstrapping ClawdHub
  - Implementing schema/auth/search/versioning
  - Reviewing API and upload/download flows
---

# ClawdHub — product + implementation spec (v1)

## Goals
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
- `role`: `admin | moderator | user`
- `createdAt`, `updatedAt`

### Skill
- `slug` (unique)
- `displayName`
- `ownerUserId`
- `summary` (from SKILL.md frontmatter `description`)
- `latestVersionId`
- `latestTagVersionId` (for `latest` tag)
- `tags` map: `{ tag -> versionId }`
- `badges`: `{ redactionApproved?: { byUserId, at } }`
- `stats`: `{ downloads, stars, versions, comments }`
- `status`: `active` only (soft-delete on version/comment only)
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
  `requires` (`bins`, `anyBins`, `env`, `config`), `install[]`
  - `metadata` in frontmatter is YAML (object) preferred; legacy JSON-string accepted.

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
- Admin UI to promote/demote roles; all changes logged.

## Upload flow (50MB per version)
1) Client requests upload session.
2) Client uploads each file via Convex upload URLs (no binaries, text only).
3) Client submits metadata + file list + changelog + version + tags.
4) Server validates:
   - total size ≤ 50MB
   - file extensions/text content
   - SKILL.md exists and frontmatter parseable
   - version uniqueness
5) Server stores files + metadata, sets `latest` tag, updates stats.

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
- Home: search + filters + trending/featured + “Highlighted” batch.
- Skill detail: README render, files list, version history, tags, stats, badges.
- Upload/edit: file picker + version + tag + changelog.
- Account settings: name + delete account (soft delete).
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
