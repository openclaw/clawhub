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

## Ban + unban batches

- Ban/unban skill batches are paginated and may continue after the mutation that
  started them has committed.
- Unban restore pages must re-read the owner before processing. If the owner is
  missing, banned again, or deactivated, the stale page must abort without
  restoring skills or scheduling another page.
- Restore pages only clear the exact `softDeletedAt` timestamp from the ban
  being lifted and only for skills hidden with `moderationReason = "user.banned"`.

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
  hide the affected skill. Skill report timelines are stored in
  `skillModerationEventLogs`.
- Package owners and publisher members can read package moderation status via
  API/CLI, including open report count, latest release moderation state, and
  download-block reasons. Reporter identities and report bodies remain moderator
  intake data.
- Package publish actions may spend time validating and scanning before the
  final release write. The final `insertReleaseInternal` mutation must re-read
  the publish actor, owner user, and owner publisher and reject if any of those
  principals are banned, deactivated, or deleted.
- OpenClaw install clients can read the exact-release public trust endpoint at
  `GET /api/v1/packages/{name}/versions/{version}/security` without owner or
  moderator credentials. The endpoint returns only package identity, exact
  release artifact identifiers, and the install-consumable trust summary.
- `trust.blockedFromDownload` is the canonical install block signal for package
  releases. OpenClaw must use it instead of re-deriving blocking behavior from
  individual scan or moderation fields. `trust.reasons` is the compact user and
  audit explanation list, for example `manual:quarantined`, `scan:malicious`,
  or `package:malicious`; public trust responses must not expose open report
  counts.
- The legacy skill/package appeal tables and backend routes remain for
  compatibility, but the first-class CLI and docs surface is deprecated.
  Publisher recovery for false positives should use reports or out-of-band
  support, while account bans require out-of-band support.
- Any ClawScan path that determines a skill is malicious must hide the skill and
  schedule the same account-level autoban/token-revocation workflow. Static
  scan findings are ClawScan input context only and must not schedule autobans
  or set public/install-blocking trust by themselves.
- Pending skill ownership transfers must not be accepted when the requesting
  owner is deleted/deactivated or when the skill is malicious, hidden, or
  removed. The accept path is the final shared gate before ownership changes,
  so it must cancel the pending transfer before reporting the rejection.
- Publisher-authored scan notes are no longer part of the ClawScan input
  contract. ClawScan decisions must be based on submitted artifacts, scanner
  signals, and staff moderation state, not publisher-supplied explanatory text.
  Legacy persisted note fields may exist on old rows for schema compatibility,
  but publish, rescan, API, UI, and prompt paths must ignore them.
- `auditLogs` remains the global compliance/security ledger. Product-facing
  moderation timelines live in `skillModerationEventLogs` and
  `packageModerationEventLogs`.
- Ownership-adjacent identity changes must also write `auditLogs`: user profile
  sync/update/ensure/delete, personal publisher create/sync, and org trusted
  publisher set/unset. Personal publisher sync should log meaningful create,
  change, link, or membership events, not routine login refreshes.
- Public queries hide non-active moderation statuses; moderators can still access via
  moderator-only queries and unhide/restore/delete/ban.
- Public skill raw-file, README, package-compat file, and zip download reads must
  honor the same malware/pending/hidden/removed download block. Metadata routes
  may keep exposing malware-blocked skill summaries for transparency, but they
  must not serve the blocked artifact payload to public callers.
- Skill version tags and `latestVersionId` are only valid when the referenced
  `skillVersions` row belongs to the same skill and is not soft-deleted. Writers
  must reject cross-skill tag targets, and public readers should treat stale
  cross-skill pointers as missing versions.
- Legacy report rows with `status: "triaged"` are read as `confirmed` for
  compatibility while new writes store `confirmed`.
- Skills directory supports an optional "Hide suspicious" filter to exclude
  active-but-flagged (`flagged.suspicious`) entries from browse/search results.

## Skill moderation pipeline

- New skill publishes now persist a deterministic static scan result on the version.
- Static findings are internal evidence for Codex-backed ClawScan only. They do
  not hide, block, set public security status, affect installability, or trigger
  user autobans.
- Public artifact pages present SkillSpector findings, VirusTotal malware telemetry,
  and ClawScan-powered risk review as one consolidated Security audit page.
  This is a product-facing model only; scanner storage, moderation decisions,
  and worker behavior remain separate internally.
- ClawScan verdicts come from a GitHub Actions Codex worker, not a single
  hosted LLM call. Publishes enqueue a scan job that waits at most 10 minutes
  for VirusTotal telemetry, then Codex reviews the materialized artifact
  workspace with static and VT signals as context.
- ClawScan worker concurrency is an operator-controlled compute concern. The
  backend claim path must cap only a single worker claim size and must not impose
  a global active-scan ceiling; horizontal capacity is controlled by worker
  dispatch count, worker batch limit, provider quotas, and cost monitoring.
- The Skill Card verification envelope exposes ClawScan as the top-level
  `security` verdict for install automation, with deterministic and third-party
  scanner evidence grouped under `security.signals`. Clients should key install
  decisions off `ok`, `decision`, `reasons`, and `security.status` instead of
  re-deriving trust from individual signal payloads.
- ClawScan verdicts treat purpose-aligned notes as user guidance, not a
  suspicious verdict. Medium-only material concerns are visible
  `flagged.review` guidance and must not set `isSuspicious`; high or critical
  concerns remain `flagged.suspicious` and are hidden by the suspicious filter.
- VirusTotal is telemetry only. It is included in the Codex workspace as signal,
  but VT alone must never hide, block, or set malicious/suspicious public status.
  The public Security audit UI may summarize vendor engine counts, including
  non-zero malicious or suspicious counts, but that display does not make VT a
  blocking verdict source.
- VirusTotal engine stats with zero malicious and zero suspicious detections and
  one or more undetected engines are resolved no-detections telemetry, not an
  in-progress scan. ClawHub should cache them as clean VT results instead of
  leaving public badges pending.
- All-active daily VirusTotal sweeps are disabled. Any future recurring VT
  freshness job must be bounded or delta-driven, and must not starve
  publish-triggered ClawScan jobs.
- Prompt-injection pre-scan hits are also context for Codex, not a deterministic
  post-Codex veto. The release worker must not downgrade a benign Codex verdict
  solely from regex telemetry.
- Artifacts remain visible while Codex runs unless another non-scanner moderation
  hold applies. Codex malicious verdicts hide/block.
- Plugins under `@openclaw/*` owned by the OpenClaw publisher are trusted by
  default. They may still be audited, but scanner telemetry alone must not
  downgrade them.
- Operators can schedule targeted ClawScan rescans for suspicious skills by bucket
  (`all`, `llm-only`, `vt-only`, `both`) and for suspicious plugin releases.
- Package/plugin scan backfills may recompute deterministic static scan results for older releases,
  but those results remain ClawScan context and are not public trust status.
- ClawPack package releases keep static/LLM scan inputs intentionally metadata-only for now:
  `package.json`, `openclaw.plugin.json`, package/source metadata, and release facts. VirusTotal
  scans the exact uploaded `.tgz`; ClawHub does not currently run deep static/LLM scans across every
  tarball file.
- Packages cache VirusTotal undetected-only engine results as clean VT telemetry.
  ClawHub does not request or consume VirusTotal AI/code-insight results; VT is
  engine/vendor telemetry only.
- Skill moderation state stores a structured ClawScan moderation snapshot:
  - `moderationVerdict`: `clean | suspicious | malicious`
  - `moderationReasonCodes[]`: canonical machine-readable reasons
  - `moderationEvidence[]`: capped file/line evidence when ClawScan produces it
  - `moderationSummary`, engine version, evaluation timestamp, source version id
- Structured moderation is rebuilt from current signals instead of appending stale scanner codes.
- Legacy moderation flags remain in sync for existing public visibility and suspicious-skill filtering:
  - `flagged.review`: visible review guidance, not hidden by default.
  - `flagged.suspicious`: hidden by the suspicious filter.
  - `blocked.malware`: hidden/blocked malicious state.
- Operators can force-rebuild skill moderation from the latest version to clear stale aggregate rows
  after ClawScan policy changes. Conservative cleanup may soft-hide exact test/placeholder
  suspicious skills, but broad duplicate-looking families require separate human review.
- Static scan evidence must identify a concrete risky source/sink, not just adjacent primitives:
  - declared provider credentials and declared provider base URLs are not credential-harvest findings by themselves.
  - user-directed provider uploads are not exfiltration unless the source is broad/private/sensitive, automatic, or sent to an unrelated/hidden destination.
  - Basic Auth/base64 credential encoding and provider-response base64 decoding are normal integration behavior.
  - scoped uninstall cleanup under a skill-owned `.openclaw` path is not a destructive-delete finding unless it deletes a broad/protected path or hides impact.
  - stealth/anti-detection browser automation becomes malicious only when paired with bot-protection bypass and persistent sessions.
- Static malware detection still records deterministic findings such as
  obfuscated shell payload prompts, but those findings are context for ClawScan,
  not a standalone hard block or uploader moderation trigger.

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
  - soft-deletes all owned packages/plugins with a ban-specific reason marker
    and revokes package publish tokens
    - the first package batch may run before `users.deletedAt` is committed;
      later paginated package batches must match the current ban timestamp
    - packages already hidden by an earlier user ban are retimestamped to the
      current ban so the next matching unban can restore them
  - retimestamps already ban-hidden owned skills to the current ban marker so
    a later matching unban can restore them
  - soft-deletes all authored skill comments + soul comments
  - revokes API tokens
  - sets `deletedAt` on the user
- Admins can manually unban (`deletedAt` + `banReason` cleared); revoked API tokens
  stay revoked and should be recreated by the user.
- The external appeals site may query ban context and accept account-ban appeals
  through the dedicated `CLAWHUB_BAN_APPEALS_TOKEN` service path. Accepted
  appeals record the Discord reviewer id in audit metadata; the token must not
  authorize any other moderation action. Accepted appeals must use the same
  matching-ban restore behavior as admin unbans for skills and packages/plugins
  and must only clear accounts with a current `user.ban` or
  `user.autoban.malware` audit matching the ban timestamp.
  Package/plugin restore audit entries from this service path are actorless;
  reviewer provenance belongs on the `user.unban` service audit metadata, not
  on the restored user's package audit rows.
  Ban context lookup must tolerate duplicate Convex Auth account rows by
  selecting the currently banned user with matching ban audit evidence.
- Unban restore batches only restore packages/plugins hidden by the matching
  ban timestamp and must stop if the user has been banned again.
- Stale unban restore batches must stop if the user was banned again before a
  later page runs.
- Optional ban reason is stored in `users.banReason` and audit logs.
- Admins can reclassify an existing ban reason without unbanning or restoring
  content. This preserves the ban while removing users from remediation flows
  that key off a specific historical reason such as `malware auto-ban`.
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
