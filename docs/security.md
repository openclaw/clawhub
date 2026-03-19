---
summary: "Security + moderation controls (reports, bans, upload gating)."
read_when:
  - Working on moderation or abuse controls
  - Reviewing upload restrictions
  - Troubleshooting hidden/removed skills
---

# Security + Moderation

## Roles + permissions

- user: upload skills/souls (subject to GitHub age gate), report skills/comments.
- moderator: hide/restore skills, view hidden skills, unhide, soft-delete, ban users (except admins).
- admin: all moderator actions + hard delete skills, change owners, change roles.

## Reporting + auto-hide

- Reports are unique per user + target (skill/comment).
- Report reason required (trimmed, max 500 chars). Abuse of reporting may result in account bans.
- Per-user cap: 20 **active** reports.
  - Active skill report = skill exists, not soft-deleted, not `moderationStatus = removed`,
    and the owner is not banned.
  - Active comment report = comment exists, not soft-deleted, parent skill still active,
    and the comment author is not banned/deactivated.
- Auto-hide: when unique reports exceed 3 (4th report):
  - skill report flow:
    - soft-delete skill (`softDeletedAt`)
    - set `moderationStatus = hidden`
    - set `moderationReason = auto.reports`
    - set embeddings visibility `deleted`
    - audit log entry: `skill.auto_hide`
  - comment report flow:
    - soft-delete comment (`softDeletedAt`)
    - decrement comment stat via `uncomment` stat event
    - audit log entry: `comment.auto_hide`
- Public queries hide non-active moderation statuses; staff can still access via
  staff-only queries and unhide/restore/delete/ban.
- Skills directory supports an optional "Hide suspicious" filter to exclude
  active-but-flagged (`flagged.suspicious`) entries from browse/search results.

## Skill moderation pipeline

- New skill publishes now persist a deterministic static scan result on the version.
- Skill moderation state stores a structured snapshot:
  - `moderationVerdict`: `clean | suspicious | malicious`
  - `moderationReasonCodes[]`: canonical machine-readable reasons
  - `moderationEvidence[]`: capped file/line evidence for static findings
  - `moderationSummary`, engine version, evaluation timestamp, source version id
- Structured moderation is rebuilt from current signals instead of appending stale scanner codes.
- Legacy moderation flags remain in sync for existing public visibility and suspicious-skill filtering.
- Static malware detection now hard-blocks install prompts that tell users to paste obfuscated shell payloads
  (for example base64-decoded `curl|bash` terminal commands). When triggered:
  - the uploaded skill is hidden immediately
  - the uploader is placed into manual moderation
  - all owned skills are hidden until staff review

## AI comment scam backfill

- Moderators/admins can run a comment backfill scanner to classify scam comments with OpenAI.
- Scanner stores per-comment moderation metadata:
  - `scamScanVerdict`: `not_scam | likely_scam | certain_scam`
  - `scamScanConfidence`: `low | medium | high`
  - explanation/evidence/model/check timestamp fields on `comments`.
- Auto-ban trigger is intentionally strict:
  - only `certain_scam` with `high` confidence can trigger account ban.
  - moderator/admin accounts are never auto-banned by this pipeline.
- Ban reason is bounded to 500 chars and includes concise evidence + comment/skill IDs.
- CLI run examples:
  - one-shot: `npx convex run commentModeration:backfillCommentScamModeration '{"batchSize":25,"maxBatches":20}'`
  - background chain: `npx convex run commentModeration:scheduleCommentScamModeration '{"batchSize":25}'`

## Bans

- Banning a user:
  - hard-deletes all owned skills
  - soft-deletes all authored skill comments + soul comments
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

- Skill + soul publish actions require GitHub account age ≥ 14 days.
- Skill + soul comment creation also requires GitHub account age ≥ 14 days.
- Lookup uses GitHub `created_at` fetched by the immutable GitHub numeric ID (`providerAccountId`)
  and caches on the user:
  - `githubCreatedAt` (source of truth)
- Gate applies to web uploads, CLI publish, GitHub import, and comments.
- If GitHub responds `403` or `429`, publish fails with:
  - `GitHub API rate limit exceeded — please try again in a few minutes`
- To reduce rate-limit failures, set `GITHUB_TOKEN` in Convex env for authenticated
  GitHub API requests.

## Empty-skill cleanup (backfill)

- Cleanup uses quality heuristics plus trust tier to identify very thin/templated
  skills.
- Word counting is language-aware (`Intl.Segmenter` with fallback), reducing
  false positives for non-space-separated languages.
