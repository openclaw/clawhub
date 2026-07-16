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

- user: upload skills (subject to GitHub age gate), report skills/packages.
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

## Exact-version revocation

- Staff can permanently revoke one hosted skill version without deleting the
  publisher account or preventing a later corrected version.
- Revocation soft-deletes the `skillVersions` row and records
  `manualRevocation` evidence with the reason, reviewer, and timestamp. Revoked
  versions must remain unavailable from exact-version metadata, raw-file, and
  ZIP download paths.
- If the revoked version is current, `latestVersionId`, `latest` tags, card
  metadata, embeddings, and search state move to the highest remaining
  non-revoked, non-malicious version.
- If no usable version remains, the skill gets its own
  `moderationReason = "manual.version_revoked"` hold and no latest pointer.
  This hold is intentionally independent from `user.banned`, so account unban
  cannot re-expose the revoked skill history.
- Publishing a new version may make that corrected version current and clear
  the skill-level hold. It must never clear `manualRevocation` or
  `softDeletedAt` from older revoked versions.

## Account and publisher deletion

- User and org deletion are soft-delete flows. They must not hard-delete users,
  publishers, memberships, skills, packages/plugins, reports, or audit rows.
- Deleting a personal account hides personal publisher resources and any orgs
  where that user is the sole owner. Multi-owner orgs stay active.
- Deleting an org publisher marks the publisher deleted/deactivated and hides
  resources owned by that publisher. Skills are hidden with
  `moderationReason = "publisher.deleted"` and packages/plugins with
  `softDeletedReason = "publisher.deleted"`.
- Public/user-facing browse, detail, install, raw-file, and package download
  paths must continue to exclude soft-deleted resources regardless of whether
  the deletion came from moderation, account deletion, or org deletion.

## Publisher abuse scoring

- Publisher abuse scoring classifies bulk-publishing abuse for staff review and
  warning-first automatic enforcement. Scheduled pressure scoring runs daily.
  Plain temporal dry runs are read-only. The scheduled temporal scan explicitly
  opts into archived dry-run signal rows for the staff Signals tab. It persists
  bounded source pages, exact percentile samples, and review candidates, then
  resumes through percentile and classification phases. Temporary scan rows
  expire after seven days. Explicitly bounded manual scans remain diagnostic-only.
  The `review` label remains a calibration/manual-review signal. The
  `potential_ban_candidate` label is an
  enforcement signal only for pressure-score nominations: the first eligible
  enforcement sweep must warn the linked non-staff user by email and persist the
  warning score/run/deadline on the nomination. A later sweep may automatically
  ban only after the warning deadline has passed and a newer pressure score
  still places the publisher in `potential_ban_candidate`. A stale warning by
  itself is not enough to ban.
- Temporal download percentiles use the full active-skill population, including
  zero-download, official, staff-owned, and personal skills. Publisher
  exclusions apply only to review candidates, not to the platform benchmark.
  Partial scans must not archive signals or present their top-download slice as
  a platform percentile.
- Flat-install temporal review signals are deliberately high-confidence:
  sustained volume must exceed the platform P99, reach at least 3,000 downloads
  in 30 days, and have at most 5 installs; a spike must exceed the platform P99,
  reach at least 2,000 downloads in 7 days, and have at most 2 installs. These
  signals indicate anomalous traffic for manual review, not publisher attribution.
- Publisher abuse scoring must skip staff-linked and official publishers before
  nominations are created. Publisher abuse autoban must process pending
  `potential_ban_candidate` pressure nominations without waiting for the score
  run to finish. It must not warn or autoban `review` nominations, historical
  backfill temporal nominations, partial current temporal nominations,
  nominations without a linked user account, or candidates whose linked user has
  no email address. Skipped pending nominations must be moved out of pending
  status with an explanatory review event so the cron does not retry them
  forever.
- Publisher abuse automatic bans must still use the account ban flow, including
  token revocation, owned listing hiding, audit logging, and the normal
  suspension/appeal email.
- Publisher abuse Signals are manual-review telemetry only. They must not feed
  automatic ban pressure. Staff can keep a signal `open`, `snoozed`, or
  `dismissed`; there is no separate escalation state. Active snoozed and
  dismissed signals stay out of the default Signals queue. A snoozed signal
  reopens only when the same signal is seen again after its snooze deadline.
- Hermit owns Discord notification delivery for publisher abuse Signals.
  ClawHub queues Hermit digests only for changed open signals: newly archived
  signals, repeated open signals with a higher seen count, manual reopens, and
  expired snoozes that are seen again. Active snoozed or dismissed signals must
  update their metric snapshot without notifying Hermit.
- Aggregate publisher spam-abuse labels start at the 200-skill pivot. Below
  that pivot, publishers can contribute to the population baseline, but they
  cannot receive aggregate spam reason codes or be nominated by this score path.
- At or above the pivot, catalog volume raises pressure multiplicatively while
  installs, stars, and downloads lower it. Legitimate high-adoption publishers
  with large catalogs should stay below review thresholds.
- Engagement expectations scale sublinearly with catalog size. The scorer must
  not require every extra skill to have the same per-skill installs/stars as the
  first 200 skills; a few successful skills can lower pressure for the broader
  catalog. Catalog size still raises pressure, so large low-adoption catalogs
  remain eligible for review or ban-candidate labels.
- Official publishers are excluded from publisher abuse scoring and
  enforcement. An excluded publisher must not contribute to score-run cohort
  statistics, receive a score label/rank, open or update a nomination, appear in
  the dashboard/detail state, or be actionable through a stale nomination id.
- The exclusion is backend-enforced. The management UI must derive its publisher
  abuse list from the filtered backend dashboard state instead of applying a
  separate client-side official-org filter.

## Reporting + auto-hide

- Reports are unique per user + target (skill/package).
- Report reason required (trimmed, max 500 chars). Abuse of reporting may result in account bans.
- Per-user cap: 20 **active** reports.
  - Active skill report = skill exists, not soft-deleted, not `moderationStatus = removed`,
    and the owner is not banned.
  - Active package report = package exists, not soft-deleted, and the owner is
    not banned/deactivated.
- Auto-hide: when unique reports exceed 3 (4th report):
  - skill report flow:
    - soft-delete skill (`softDeletedAt`)
    - set `moderationStatus = hidden`
    - set `moderationReason = auto.reports`
    - set embeddings visibility `deleted`
    - audit log entry: `skill.auto_hide`
- Package reports feed `clawhub-admin package moderation-queue` and audit `package.report`,
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
- Any ClawScan path that determines a skill or plugin release is malicious must
  block that candidate version and notify the publisher with local
  `clawhub scan` remediation guidance. Scanner-triggered emails are
  artifact-level and must not link to account appeals. Account-level autoban,
  token revocation, and appeal email only happen after the silent escalation
  thresholds: two distinct malicious artifacts or three malicious attempts on
  the same artifact. Static scan findings are ClawScan input context only and
  must not schedule account autobans or set public/install-blocking trust by
  themselves.
- Pending skill ownership transfers must not be accepted when the requesting
  owner is deleted/deactivated or when the skill is malicious, hidden, or
  removed. The accept path is the final shared gate before ownership changes,
  so it must cancel the pending transfer before reporting the rejection.
- User-submitted `POST /api/v1/skills/-/scan` upload scans are authenticated but
  ephemeral. They store uploaded files only on `skillScanRequests`, feed the
  normal ClawScan worker, and must never create or patch public `skills`,
  `skillVersions`, moderation, or trust state. Expired `skillScanRequests` rows
  must be pruned by cron so uploaded file payloads do not become durable skill
  storage. Published scan requests may patch a version only when the caller can
  manage the skill and explicitly sets `update: true`; local uploads must reject
  update mode.
- GitHub-backed skill verification also uses ephemeral `skillScanRequests` to
  feed exact current skill-folder bytes into the normal ClawScan worker. Large
  file manifests use a prepare, bounded child-chunk append, and finalize sequence
  rather than one oversized Convex document or function argument. The request
  must exist before blob storage begins, each bounded chunk is durably attached
  as it is stored, descriptor metadata is capped at 4 MiB, and worker claims
  hydrate one signed-URL-heavy job at a time. A recently prepared request remains
  leased until finalization so concurrent syncs cannot replace it. Unlike
  user-submitted upload scans, its completed ClawScan, SkillSpector, and static
  context are persisted on `githubSkillScans` by skill and content hash so the
  public Security audit remains available after request files are pruned through
  bounded continuation batches. Cleanup cancels the linked worker job before
  deleting the first chunk. Legacy source-backed statuses without a durable
  `githubSkillScans` result must return to pending on sync rather than remain
  trusted. Explicit owner/moderator rescans use the manual worker queue.
  GitHub-backed verification must not create or patch a hosted `skillVersions`
  row, and static findings remain input context rather than a blocking verdict.
- `auditLogs` remains the global compliance/security ledger. Product-facing
  moderation timelines live in `skillModerationEventLogs` and
  `packageModerationEventLogs`.
- Ownership-adjacent identity changes must also write `auditLogs`: user profile
  sync/update/ensure/delete, personal publisher create/sync, and org trusted
  publisher set/unset. Personal publisher sync should log meaningful create,
  change, link, or membership events, not routine login refreshes.
- Public queries hide non-active moderation statuses; moderators can still access via
  admin-only queries and unhide/restore/delete/ban.
- Public skill raw-file, README, package-compat file, and zip download reads must
  honor the same malware/pending/hidden/removed download block. Metadata routes
  may keep exposing malware-blocked skill summaries for transparency, but they
  must not serve the blocked artifact payload to public callers. Exact-version
  skill and package metadata routes must also block when the requested version is
  the moderated source version.
- Skill version tags and `latestVersionId` are only valid when the referenced
  `skillVersions` row belongs to the same skill and is not soft-deleted. Writers
  must reject cross-skill tag targets, and public readers should treat stale
  cross-skill pointers as missing versions.
- Legacy report rows with `status: "triaged"` are read as `confirmed` for
  compatibility while new writes store `confirmed`.
- Skills directory supports an optional "Hide suspicious" filter to exclude
  active-but-flagged (`flagged.suspicious`) entries from browse/search results.

## Package publish upload boundary

- Package publish is multipart-only. `POST /api/v1/packages` must reject JSON
  request bodies, including bodies that reference pre-existing storage IDs.
- Public HTTP package publish payloads must not accept caller-supplied `files`
  or `artifact` metadata. Internal publish actions may receive that metadata
  only after the HTTP boundary derives it from uploaded multipart bytes or a
  staged ClawPack blob.
- Package publish accepts either multipart `files` uploads or one `clawpack`
  tarball reference, never both in the same request. `clawpack` may be a direct
  `.tgz` file part or a Convex storage id created by the upload-url flow. The
  storage-id path must include the matching `clawpackUploadTicket`, and the
  server must reject tickets from a different auth context, expired or used
  tickets, and storage blobs created before the ticket.
- Direct package publish multipart bytes are capped at 18MB so callers get a
  clear ClawHub validation error before hitting Convex's 20MB HTTP action body
  cap. ClawPack tarballs keep the 120MB package tarball cap through staged
  storage uploads.
- For tarball uploads, ClawHub stores the uploaded tarball, derives its
  artifact hashes and npm metadata, and derives package file metadata from the
  tarball contents.

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
- Current skill and plugin scans are queued through `securityScanJobs` and
  completed by the external Codex worker.
- The worker's explicit artifact-only OSS ClawScan route accepts every claimed
  target kind and source through the same completion/failure contract. Skill
  versions and scan requests use the isolated `artifact` root; extracted
  ClawPack releases use `artifact/package`.
- The temporary whole-system rollout mode accepts exactly `legacy`, `shadow`,
  and `clawscan`, with `legacy` as the safe default until the production
  cutover is explicitly approved. `legacy` runs only the legacy implementation.
  `shadow` persists legacy authoritatively, then runs ClawScan diagnostically
  against the same isolated artifact. `clawscan` persists ClawScan
  authoritatively, then runs legacy diagnostically against that same artifact
  during the soak. Secondary execution cannot change stored verdicts,
  publication or moderation behavior, retries, or authoritative job success.
  Authoritative ClawScan failures use the existing failure/retry lifecycle and
  never trigger per-job legacy fallback. Rollback is a manual whole-system mode
  change to `legacy`.
- Every worker run publishes a GitHub Actions summary and uploads a structured
  summary with its secret-scanned diagnostics. The summary reports authoritative
  completions, failures, timeouts, scanner-stage and judge-stage failures,
  duration, throughput, queue health, and verdict totals. `shadow` and
  `clawscan` additionally report authoritative/secondary verdict pairs, exact
  matches, secondary failures, and disagreement direction. Queue-health lookup
  failures are diagnostic-only and must not change authoritative persistence,
  retries, or the worker exit result. A valid parsed scanner report with
  findings is a completed scanner stage when SkillSpector uses exit code `1`
  with a `suspicious` or `malicious` report containing at least one finding.
  Other nonzero exits remain failures. Scanner-stage failures also include a
  timeout, missing process exit status, missing or unparseable report, or
  parsed `error`/`failed` status.
- Retained worker diagnostics preserve every redacted Codex/legacy output
  record plus complete redacted ClawScan artifacts, per-scanner outputs, and
  comparison records without per-file or aggregate-size truncation. Bounded
  metadata/error fields may remain capped. Artifact upload still requires the
  existing verified-secret scan to pass.
- Claimable queue work edge-triggers a coalesced GitHub Actions worker dispatch.
  Successful completion requests another dispatch while queued work remains; a
  five-minute Convex cron is only a recovery watchdog for lost dispatch signals.
  Convex emits the narrowly typed `clawhub-security-scan`
  `repository_dispatch` event using the production GitHub App. Event-driven
  dispatch stays disabled until that installation is verified to have Contents
  write permission.
- Queue source priority is `manual`, `backfill`, `publish`, `vt-update`, then
  `bulk-rescan`. A later VirusTotal update may make a waiting publish job
  claimable immediately, but it must not demote that job from publish priority.
- Bulk rescans stay lowest priority and use the bounded operator campaign flow,
  which enqueues one page at a time and waits for that page before continuing.
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
  hold applies. Codex malicious verdicts block the candidate version. On updates,
  the previous clean/current public version remains live; on first versions,
  nothing public is promoted.
- `skillSearchDigest.publicVersion` is a derived public-browse cache, not a
  moderation source of truth. `available` points to the exact approved public
  `skillVersions` row and `unavailable` fails closed; a missing value exists only
  during rollout/backfill and uses the legacy resolver. Skill visibility changes
  and version scan-status changes must refresh the cache so hot browse/search
  queries never need to walk version history.
- Plugins under `@openclaw/*` owned by the OpenClaw publisher are trusted by
  default. They may still be audited, but scanner telemetry alone must not
  downgrade them.
- Operators can schedule ClawScan rescans through `securityScanJobs`: single
  skill/package rescans for a chosen artifact, or paged all-active-latest skill
  rescan batches. The old suspicious LLM bucket tools (`all`, `llm-only`,
  `vt-only`, `both`) are retired.
- Package/plugin scan backfills may recompute deterministic static scan results for older releases,
  but those results remain ClawScan context and are not public trust status.
- ClawPack package releases materialize parsed npm-pack artifact entries into the release file
  surface. Static scan, LLM review, package inspect/file APIs, and Codex package ClawScan use those
  stored artifact entries instead of metadata-only `package.json` / `openclaw.plugin.json` rows.
  VirusTotal still scans the exact uploaded `.tgz`; ClawHub also retains the stored ClawPack artifact
  so scanner workers can download/extract it for artifact-backed review.
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
  - Browser automation, stealth browsing, and anti-bot/crawling behavior are not classified by ClawHub's static scanner. SkillSpector owns that browser-automation analysis lane; ClawHub static rules should only preserve non-browser-specific concrete source/sink evidence.
- Static malware detection still records deterministic findings such as
  obfuscated shell payload prompts, but those findings are context for ClawScan,
  not a standalone hard block or uploader moderation trigger.

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
  - revokes API tokens
  - sets `deletedAt` on the user
- Admins can manually unban (`deletedAt` + `banReason` cleared); revoked API tokens
  stay revoked and should be recreated by the user.
- The external appeals site may query ban context and accept account-ban appeals
  through the dedicated `CLAWHUB_BAN_APPEALS_TOKEN` service path. Accepted
  appeals record the Discord reviewer id in audit metadata; the token must not
  authorize any other moderation action. Accepted appeals must use the same
  matching-ban restore behavior as admin unbans for skills and packages/plugins
  and must only clear accounts with a current `user.ban`,
  `user.autoban.malware`, or `user.autoban.publisher_abuse` audit matching
  the ban timestamp.
  Package/plugin restore audit entries from this service path are actorless;
  reviewer provenance belongs on the `user.unban` service audit metadata, not
  on the restored user's package audit rows.
  Ban context lookup must tolerate duplicate Convex Auth account rows by
  selecting the currently banned user with matching ban audit evidence.
- Ban notification emails must be public-safe: include the high-level action
  reason, affected skill/plugin when known, the external appeals link, and
  scanner context when the account was escalated from repeated malicious
  artifacts. Artifact-level scanner emails must instead say the version was
  blocked, keep appeals out of the copy, and link existing CLI scan docs. Emails
  must not expose raw moderator notes, reporter identifiers, internal finding
  ids, or other staff-only ban reason text.
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

- Skill publish actions require GitHub account age ≥ 14 days.
- Lookup uses GitHub `created_at` fetched by the immutable GitHub numeric ID (`providerAccountId`)
  and caches on the user:
  - `githubCreatedAt` (source of truth)
- Gate applies to web uploads, CLI publish, and GitHub import.
- If GitHub responds `403` or `429`, publish fails with:
  - `GitHub API rate limit exceeded — please try again in a few minutes`
- To reduce rate-limit failures, configure the ClawHub GitHub App in Convex env:
  `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY`.
  Account-age/profile lookups prefer short-lived GitHub App installation
  tokens, then fall back to `GITHUB_TOKEN`, then to unauthenticated public
  requests where safe. Trusted-publisher repository identity lookups also
  prefer authenticated GitHub App or token requests for public repository
  metadata, then retry without App auth when that lookup is rejected. They must
  only accept public repository responses; private repositories need a separate
  GitHub authorization or installation flow before ClawHub can configure trusted
  publishing for them.
- If configured GitHub API auth is rejected with `401`, retry the account-age
  lookup without auth before failing. Never fall back to mutable GitHub usernames
  for this gate; use the operator backfill to cache missing ages for existing users.

## Empty-skill cleanup (backfill)

- Cleanup uses quality heuristics plus trust tier to identify very thin/templated
  skills.
- Word counting is language-aware (`Intl.Segmenter` with fallback), reducing
  false positives for non-space-separated languages.
