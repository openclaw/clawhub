---
summary: 'Security + moderation controls (reports, bans, upload gating).'
read_when:
  - Working on moderation or abuse controls
  - Reviewing upload restrictions
  - Troubleshooting hidden/removed skills
---

# Security + Moderation

## Roles + permissions

- user: upload skills/souls (subject to GitHub age gate), report skills.
- moderator: hide/restore skills, view hidden skills, unhide, soft-delete, ban users (except admins).
- admin: all moderator actions + hard delete skills, change owners, change roles.

## Reporting + auto-hide

- Reports are unique per user + skill.
- Report reason required (trimmed, max 500 chars). Abuse of reporting may result in account bans.
- Per-user cap: 20 **active** reports.
  - Active = skill exists, not soft-deleted, not `moderationStatus = removed`,
    and the owner is not banned.
- Auto-hide: when unique reports exceed 3 (4th report), the skill is:
  - soft-deleted (`softDeletedAt`)
  - `moderationStatus = hidden`
  - `moderationReason = auto.reports`
  - embeddings visibility set to `deleted`
  - audit log entry: `skill.auto_hide`
- Public queries hide non-active moderation statuses; staff can still access via
  staff-only queries and unhide/restore/delete/ban.
- Skills directory supports an optional "Hide suspicious" filter to exclude
  active-but-flagged (`flagged.suspicious`) entries from browse/search results.

## Bans

- Banning a user:
  - hard-deletes all owned skills
  - revokes API tokens
  - sets `deletedAt` on the user
- Optional ban reason is stored in `users.banReason` and audit logs.
- Moderators cannot ban admins; nobody can ban themselves.
- Report counters effectively reset because deleted/banned skills are no longer
  considered active in the per-user report cap.

## Upload gate (GitHub account age)

- Skill + soul publish actions require GitHub account age ≥ 7 days.
- Lookup uses GitHub `created_at` and caches on the user:
  - `githubCreatedAt` (source of truth)
  - `githubFetchedAt` (fetch timestamp)
- Cache TTL: 24 hours.
- Gate applies to web uploads, CLI publish, and GitHub import.
- If GitHub responds `403` or `429`, publish fails with:
  - `GitHub API rate limit exceeded — please try again in a few minutes`
- To reduce rate-limit failures, set `GITHUB_TOKEN` in Convex env for authenticated
  GitHub API requests.
