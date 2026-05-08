---
summary: "Security + moderation controls (reports, bans, upload gating)."
read_when:
  - Working on moderation or abuse controls
  - Reviewing upload restrictions
  - Troubleshooting hidden/removed skills
---

# Security + Moderation

See also: [acceptable-usage.md](./acceptable-usage.md) for the marketplace policy on prohibited skill categories.

## Roles + permissions

- user: upload skills/souls (subject to GitHub age gate), report skills/comments/packages.
- moderator: hide/restore skills, view hidden skills, unhide, soft-delete, ban users (except admins).
- admin: all moderator actions + hard delete skills, change owners, change roles.

## Reporting + auto-hide

- Reports are unique per user + target (skill/comment/package).
- Report reason required (trimmed, max 500 chars). Abuse of reporting may result in account bans.
- Per-user cap: 20 **active** reports.
  - Active skill report = skill exists, not soft-deleted, not `moderationStatus = removed`,
    and the owner is not banned.
  - Active comment report = comment exists, not soft-deleted, parent skill still active,
    and the comment author is not banned/deactivated.
  - Active package report = package exists, not soft-deleted, and the owner is
    not banned/deactivated.
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
- Package reports feed `clawhub-mod package moderation-queue` and audit `package.report`,
  but do not auto-hide or block downloads. Moderators can review a formal report
  with an explicit final action to quarantine or revoke the affected release.
- Package reports can be moved to `confirmed` or `dismissed` with a moderator
  note. Only `open` reports count toward `packages.reportCount` and user active
  report limits; confirming or dismissing a report decrements the open count.
- Skill reports now follow the same formal lifecycle: `open`, `confirmed`, or
  `dismissed`, with a single recorded `triageNote` used as the official outcome
  note. Moderators can review a formal report with an explicit final action to
  hide the affected skill. Skill report and appeal timelines are stored in
  `skillModerationEventLogs`.
- Package owners and publisher members can read package moderation status via
  API/CLI, including open report count, latest release moderation state, and
  download-block reasons. Reporter identities and report bodies remain moderator
  intake data.
- Package owners and publisher members can submit one open appeal per moderated
  package release. Accepted appeals can explicitly approve the affected release
  in the same auditable workflow.
- Skill owners and publisher members can submit one open appeal for hidden,
  removed, suspicious, malicious, or scanner-flagged skill outcomes. Skill
  appeals use `open`, `accepted`, and `rejected` states with a single
  `resolutionNote` as the official outcome note.
- Moderators can accept, reject, or reopen appeals with a resolution note.
  Accepted skill appeals can explicitly restore the skill, and accepted package
  appeals can explicitly approve the release.
- `auditLogs` remains the global compliance/security ledger. Product-facing
  moderation timelines live in `skillModerationEventLogs` and
  `packageModerationEventLogs`.
- Public queries hide non-active moderation statuses; moderators can still access via
  moderator-only queries and unhide/restore/delete/ban.
- Legacy report rows with `status: "triaged"` are read as `confirmed` for
  compatibility while new writes store `confirmed`.
- Skills directory supports an optional "Hide suspicious" filter to exclude
  active-but-flagged (`flagged.suspicious`) entries from browse/search results.

## Skill moderation pipeline

- New skill publishes now persist a deterministic static scan result on the version.
- Package/plugin scan backfills now also recompute deterministic static scan results for older releases,
  so legacy plugin versions can surface OpenClaw scan findings without republishing.
- ClawPack package releases keep static/LLM scan inputs intentionally metadata-only for now:
  `package.json`, `openclaw.plugin.json`, package/source metadata, and release facts. VirusTotal
  scans the exact uploaded `.tgz`; ClawHub does not currently run deep static/LLM scans across every
  tarball file.
- Source-linked packages can fall back to a clean package verdict when VirusTotal only returns
  undetected engine results, provided the LLM scan is clean and static scan is non-malicious. This
  avoids indefinite pending scans when VT Code Insight never materializes.
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
  - all owned skills are hidden until moderator review

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
  GitHub API requests. The same token is used for trusted-publisher repository
  identity lookups.

## Empty-skill cleanup (backfill)

- Cleanup uses quality heuristics plus trust tier to identify very thin/templated
  skills.
- Word counting is language-aware (`Intl.Segmenter` with fallback), reducing
  false positives for non-space-separated languages.
