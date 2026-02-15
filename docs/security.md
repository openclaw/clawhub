---
summary: "Security + moderation controls (reports, bans, upload gating)."
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
- Admins can manually unban (`deletedAt` + `banReason` cleared); revoked API tokens
  stay revoked and should be recreated by the user.
- Optional ban reason is stored in `users.banReason` and audit logs.
- Moderators cannot ban admins; nobody can ban themselves.
- Report counters effectively reset because deleted/banned skills are no longer
  considered active in the per-user report cap.

## User account deletion

- User-initiated deletion is irreversible.
- Deletion flow:
  - sets `deactivatedAt` + `purgedAt`
  - revokes API tokens
  - clears profile/contact fields
  - clears telemetry
- Deleted accounts cannot be restored by logging in again.
- Published skills remain public.

## Upload gate (GitHub account age)

- Skill + soul publish actions require GitHub account age ≥ 7 days.
- Lookup uses GitHub `created_at` fetched by the immutable GitHub numeric ID (`providerAccountId`)
  and caches on the user:
  - `githubCreatedAt` (source of truth)
- Gate applies to web uploads, CLI publish, and GitHub import.
- If GitHub responds `403` or `429`, publish fails with:
  - `GitHub API rate limit exceeded — please try again in a few minutes`
- To reduce rate-limit failures, set `GITHUB_TOKEN` in Convex env for authenticated
  GitHub API requests.

## Empty-skill cleanup (backfill)

- Cleanup uses quality heuristics plus trust tier to identify very thin/templated
  skills.
- Word counting is language-aware (`Intl.Segmenter` with fallback), reducing
  false positives for non-space-separated languages.

## Moderation v2 (reason codes + evidence)

- Skills now carry normalized moderation fields:
  - `moderationVerdict`: `clean | suspicious | malicious`
  - `moderationReasonCodes`: stable reason-code list
  - `moderationEvidence`: capped finding snippets (`code`, `severity`, `file`, `line`, `message`, `evidence`)
  - `moderationEngineVersion`, `moderationEvaluatedAt`, `moderationSourceVersionId`
- Legacy fields (`moderationReason`, `moderationFlags`) remain for compatibility and are kept in sync.
- Public API responses still include `isSuspicious` and `isMalwareBlocked`, plus additive fields (`verdict`, `reasonCodes`, `summary`, `engineVersion`, `updatedAt`).
- Detailed moderation endpoint:
  - `GET /api/v1/skills/:slug/moderation`
  - owner/staff receive full evidence
  - public callers receive sanitized evidence for flagged skills only

Policy:

- `malicious`: blocked from install/download.
- `suspicious`: visible with warnings; CLI install/update requires explicit confirm (or `--force` in non-interactive mode).
- `pending`: publish-time quarantine behavior unchanged.

Backfill:

- `vt.backfillModerationV2` recomputes normalized moderation fields for historical published skills in bounded batches.
