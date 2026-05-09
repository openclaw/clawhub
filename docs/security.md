---
summary: "ClawHub trust, scan, reporting, appeal, and moderation behavior."
read_when:
  - Understanding ClawHub scan and moderation outcomes
  - Reporting a skill or package
  - Recovering from a held, hidden, or blocked listing
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
- New skill publishes also query TrentClaw by the deterministic skill SHA256 and cache the
  verdict (`benign`, `vulnerable`, `malicious`, or `unknown`) on the version.
- TrentClaw is an external `api.trent.ai` service. ClawHub sends the deterministic skill
  artifact SHA256 to that service, not the skill source files or user credentials. CLI
  install/update decisions may warn or block based on the returned verdict, so changes to this
  integration require explicit maintainer/security approval of the third-party trust boundary.
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
ClawHub is open to publishing, but public listings still pass through trust,
scan, reporting, and moderation controls. The goal is practical: help users
inspect what they install, give publishers a recovery path for false positives,
and keep abusive packages out of public discovery.

See also [Acceptable usage](./acceptable-usage.md).

## What users can inspect

Before installing a skill or plugin, check its ClawHub listing for:

- owner and source attribution
- latest version and changelog
- required environment variables or permissions
- compatibility metadata for plugins
- scan or moderation status
- reports, comments, stars, downloads, and install signals where shown

Install only content you understand and trust.

## Scan states

ClawHub may show scan or moderation outcomes on public pages and owner-visible
diagnostics.

Common outcomes include:

- `clean`: no blocking issue was found.
- `suspicious`: the release needs caution or review.
- `malicious`: the release is considered unsafe.
- `pending`: checks have not finished yet.
- `held`, `quarantined`, `revoked`, or `hidden`: the release is not fully
  available on public install surfaces.

Exact wording may vary by surface, but the practical meaning is the same: if a
release is held or blocked, users should not install it until the owner resolves
the issue or moderation restores it.

## Skills

Skill scans look at the published skill bundle, metadata, declared
requirements, and suspicious instructions.

ClawHub pays special attention to mismatches between what a skill declares and
what it appears to do. For example, a skill that references a required API key
should declare that requirement in `SKILL.md` so users can see it before
installing.

See [Skill format](./skill-format.md).

## Plugins

Plugin releases include package metadata, source attribution, compatibility
fields, and artifact integrity information.

OpenClaw checks compatibility before installing ClawHub-hosted plugins. Package
records may also expose digest metadata so OpenClaw can verify downloaded
artifacts.

## Reports

Signed-in users can report skills, packages, and comments.

Reports should be specific and actionable. Abuse of reporting can itself lead to
account action.

Report examples:

- misleading metadata
- undeclared credential or permission requirements
- suspicious install instructions
- scam comments or impersonation
- bad-faith registrations or trademark misuse
- content that violates [Acceptable usage](./acceptable-usage.md)

## Bad-faith or trademark reports

ClawHub uses the same report and staff moderation pipeline for bad-faith
registrations, impersonation, and trademark-related disputes. These reports need
enough context for staff to identify the claimant, disputed listing, and
requested action.

Include:

- the canonical ClawHub skill or package URL and owner handle
- the trademark, project, company, or product name at issue
- public evidence of the claimant's ownership or authority
- why the current owner is not authorized to publish under that name
- the requested action, such as hide pending review, transfer ownership, rename,
  or remove

Do not put private secrets or sensitive legal documents in public reports. Open
a GitHub issue with non-sensitive evidence and ask maintainers for a private
handoff path when needed.

## Appeals and rescans

Owners can request a rescan when they believe a skill or package was incorrectly
held or flagged:

```bash
clawhub skill rescan <slug>
clawhub package rescan <name>
```

For moderated content, owners may be able to submit an appeal from the
owner-visible ClawHub surfaces. Appeals should explain what changed or why the
flag is incorrect.

## Moderation Holds

When the static scanner flags an uploaded skill as malicious, the publisher is
automatically placed under a moderation hold (`requiresModerationAt` set on the
user). This hides all of the publisher's skills, causes future publishes to
start hidden, and creates a `user.moderation.auto` audit log entry.

Admins can lift a false-positive hold:

```bash
npx convex run users:liftModerationHold '{"userId": "<user-id>", "reason": "False positive from security tool scanning"}'
```

This clears `requiresModerationAt` and `requiresModerationReason`, restores
skills hidden by the user-level hold, and writes a `user.moderation.lift` audit
log entry. Skills hidden for other reasons, or whose own static scan remains
malicious, stay hidden.

## Bans and account standing

Accounts that violate ClawHub policy may lose publishing access. Severe abuse
can result in account bans, token revocation, hidden content, or removed
listings.

Deleted, banned, or disabled accounts cannot use ClawHub API tokens. If CLI auth
starts failing after account action, sign in to the web UI to review account
state or contact maintainers through the expected project support channel.

## Publisher guidance

To reduce false positives and improve user trust:

- keep names, summaries, tags, and changelogs accurate
- declare required environment variables and permissions
- avoid obfuscated install commands
- link to source when possible
- use dry runs before publishing plugins
- respond clearly if users or moderators ask about package behavior
