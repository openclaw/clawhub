---
summary: "Security + moderation controls (reports, bans, upload gating)."
read_when:
  - Working on moderation or abuse controls
  - Reviewing upload restrictions
  - Troubleshooting hidden/removed skills
---

# Security + Moderation

See also: [acceptable-usage.md](./acceptable-usage.md) for the marketplace policy on prohibited skill categories.

## Security dataset redaction

- `convex/lib/securityDatasetRedaction.ts` owns the shared secret patterns for
  Convex exports and offline dataset normalization. Keep it runtime-neutral.
- Bundle content preserves tabs, line breaks, DEL, and outer whitespace; other
  ASCII controls become spaces. Stored skill Markdown also trims outer whitespace.
- Offline metadata replaces all ASCII controls and DEL, collapses whitespace,
  trims, and applies its own length limit. Offline Markdown preserves bundle
  whitespace and applies its existing nullable-input and truncation rules.
- Keep export authentication, storage access, file exclusions, and byte budgets
  at their existing caller boundaries.

## Anonymous API ingress

- Hosted anonymous HTTP requests must enter through the ClawHub Vercel edge.
  The proxy replaces caller-supplied identity headers with its Vercel OIDC
  service token and the platform-controlled visitor address. Convex verifies
  the token's issuer, audience, project, owner and deployment environment
  before using that address for quotas or download metrics.
- Unverified direct requests consume no shared quota: redirect them to the
  configured public HTTPS API origin, or reject if no safe origin is configured.
  Invalid edge assertions are rejected without redirecting, to avoid loops
  through a misconfigured proxy.
  The legacy `TRUST_FORWARDED_IPS` flag must never authorize raw IP headers.
- API tokens retain per-user quotas. A server-owned loopback Convex deployment
  may use a local development bucket when no hosted environment is configured.
- The production skills.sh mirror operator, inspector worker routes, signed
  archive metric receipts, and Convex Auth's OAuth sign-in/callback routes
  retain their handler-owned credential checks at
  the Convex origin. They do not use anonymous IP quotas or redirect credentials
  to another origin. Worker credentials never exempt ordinary public API routes
  from verified ingress.
- The skills.sh operator accepts only the verified GitHub Actions identity for
  this repository's sync workflow on `main` in the `Production` environment.
  Its Test operator continues to require an admin API token and API quotas.
- Rollout requires the identity-forwarding edge before the backend starts
  enforcing verified anonymous ingress.

## Roles + permissions

- Hidden-skill HTTP hints and private moderation evidence follow current publisher
  read access. Organization owners, admins, and publishers qualify through current
  membership; historical `ownerUserId` does not preserve access after membership
  removal. Personal publishers follow current linkage with the existing legacy
  owner fallback, and skills without a publisher retain personal-owner access.
  Existing platform staff access and public evidence redaction remain unchanged.

- Skill transfer, delete, and restore authorization follows the resource's current
  publisher ownership. For organization skills, the historical `ownerUserId` is
  not an authorization grant: current organization admin/owner membership is
  required, subject to the operation's existing platform staff permissions.
- Transfer acceptance rechecks the requester's current authority, including when
  they originally published the skill. Removing or downgrading their membership
  invalidates pending requests. Personal and legacy skills retain personal-owner
  authorization through the shared publisher ownership check.
- Changelog previews must authorize previous-version file access before reading
  stored content or invoking an AI provider. They use the same ownership, staff,
  moderation, deletion, and publication checks as direct skill file reads.
  The changelog formatter receives an already-authorized version; it must not
  resolve and load a different previous version from an untrusted slug.
- Server-side OG image requests validate all resolved IPv4/IPv6 destinations at
  the socket lookup boundary. Private, local, special-purpose, or mixed results
  are rejected. The socket receives only those checked addresses, avoiding a
  second DNS lookup; HTTPS still verifies the original hostname. Every redirect
  repeats URL and destination checks. Timeout and byte limits remain enforced.

- user: upload skills (subject to GitHub age gate), report skills/packages.
- moderator: hide/restore skills, view hidden skills, unhide, soft-delete, ban users (except admins).
- admin: all moderator actions + hard delete skills, change owners, change roles.

## Manual package scan backfill

- The public `packages.backfillPackageReleaseScans` action requires an active
  authenticated admin before traversing releases or enqueueing any scan work.
  Anonymous, ordinary-user, moderator, deleted, and deactivated callers must
  leave scan queues and scheduled backfill work unchanged.
- Manual clients must send an admin session through Convex Auth. The public
  wrapper must not accept a caller-supplied user id or rely on queue deduplication
  as authorization.
- The internal backfill and its scheduled continuations retain service access
  without a user session. Cron calls that internal entry point directly; placing
  the public admin guard inside it would break scheduled maintenance.

## Ban + unban batches

- Ban/unban skill batches are paginated and may continue after the mutation that
  started them has committed.
- Unban restore pages must re-read the owner before processing. If the owner is
  missing, banned again, or deactivated, the stale page must abort without
  restoring skills or scheduling another page.
- Restore pages only clear the exact `softDeletedAt` timestamp from the ban
  being lifted and only for skills hidden with `moderationReason = "user.banned"`.

## Publication visibility at public reads

- A public skill version or plugin release must belong to the selected parent,
  be published (or be a legacy row without `publicationStatus`), and have neither
  `softDeletedAt` nor `ownerDeletedAt`. Pending and blocked submissions remain
  unavailable even when a caller knows their version, tag, identifier, or hash.
- Resolve the current parent and selected version together in the domain query.
  HTTP adapters compose that checked result with the existing parent visibility,
  viewer authorization, and download policy before returning metadata or reading
  storage. Cached summaries, tags, export digests, and fingerprint indexes are
  selection hints; none independently authorize a public read.
- Apply the same publication boundary to files, cards, verification, skill aliases
  under the packages API, direct and hosted ZIPs, tag labels, description fallback,
  and exports. Batch export selection checks in small bounded groups before loading
  blobs. A missing requested tag must not silently select the latest version.
- Hash resolution checks every candidate against its current parent and version.
  A withheld newer match must not hide an older published match. Maintain the
  existing public parent policy and bounded indexed/fallback search.
- Publication and scan state are separate: published metadata remains inspectable
  where existing policy allows it, while malicious/failed skill downloads and
  quarantined/revoked package downloads remain blocked. A pending package scan is
  not an unpublished release. Authorized owner/staff submission previews retain
  their separate access path.
- Pending skill finalization must not lift `softDeletedAt`, `moderationStatus`
  `removed`, or a hidden staff hold such as security redaction, a ban, publisher
  deletion, or manual review. A first publish hidden only for
  `pending.publication` still finalizes. A version that becomes latest may
  replace scanner state, a quality quarantine, publisher moderation, or
  `manual.version_revoked`, and it copies the staged icon the same way an
  immediate publish does. An older version still becomes published, and it
  leaves the live skill's moderation, hold, and icon alone.
- Pending package finalization changes `channel` and `isOfficial` only when
  that release becomes latest. An older release can still publish without
  rolling the live package back to the channel it staged. A private release
  that would not become latest is refused instead, because package privacy
  is the parent channel and publishing it would expose the artifact.
- Changes to version publication or owner-deletion state invalidate public browse
  projections. A pending replacement must preserve an older approved version where
  the existing latest-version policy selects it.

## Owner withdrawal of unpublished package releases

- Staging a package release stores requested `distTags` before publication; these
  are publication intent, not authoritative public tag assignments. Multiple
  unpublished candidates may carry `latest`, including after package restoration.
- Owner withdrawal must not interpret an unpublished candidate's `latest` dist-tag
  as the current latest release. Package `latestReleaseId`, `tags.latest`, and
  `latestVersionSummary` remain protective, and a published (including legacy)
  release's own `latest` tag remains a conservative fallback.
- Ignoring an unpublished tag does not waive the existing available-survivor
  check, ownership checks, moderation checks, or retained withdrawal provenance.
  Withdrawing an abandoned candidate must preserve the replacement release and
  the package's current latest metadata.

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
  Temporal traffic detection has two entrypoints: a read-only bounded preview
  and one resumable scheduled pipeline that is the sole writer of signal rows.
  The scheduled pipeline persists bounded source pages, exact percentile
  samples, and candidate observations, then
  resumes through percentile and classification phases. Temporary scan rows
  expire after seven days. A failed step retries from the last persisted cursor
  with bounded backoff; any successfully persisted page resets the consecutive
  failure count. A watchdog treats fifteen minutes without persisted progress as
  a failed attempt. After five consecutive failed attempts, the run becomes
  terminal, retains the last error for the staff UI, emits the structured
  `publisher_temporal_abuse_scan_failed` operator event.
  Moderators can start this same full signal pipeline from the staff Signals tab.
  New manual starts record the actor; requests made while a temporal scan is
  already active return that run without starting a competing worker. Stale
  recovery continues the same durable run instead of replacing it, and
  cursor-guarded writes prevent overlapping late workers from duplicating work.
  Explicitly bounded previews remain diagnostic-only. Moderators can cancel the
  displayed running signal scan without deleting recorded evidence. Cancellation
  uses the shared terminal state so scheduled work stops, records the actor, and
  is a no-op if that exact run has already finished or been replaced. A signal run
  from an older model must not lock the control that starts its replacement.
  New scan indexes must ship in a staging-only release before any function
  queries them. Keep the indexes marked `staged: true`, deploy that schema,
  and wait until Convex reports every index ready. Only a later release may
  activate and query them. This applies to
  `by_run_id_and_excess7_downloads`,
  `by_run_id_and_synchrony_eligible_and_owner_key`, and
  `by_owner_key_and_signal_type`.
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
- Temporal download signals compare each skill with both its own frozen history
  and the full active-skill population. A 7-day surge requires both its growth
  multiple and its absolute downloads above the frozen baseline to exceed the
  platform P99, regardless of install count. A standalone skill signal must also
  reach at least 6,400 downloads in seven days or 7/30 of ten times the platform
  30-day download P99, whichever is higher. The lower proportional floor of
  7/30 of the sustained-traffic threshold is only enough to participate in a
  publisher-wide synchronization check; it never creates a standalone skill
  signal. These requirements prevent a tiny baseline or a low platform
  percentile from turning modest isolated traffic into a signal. The stored
  `download_spike_flat_installs` identifier is retained only so existing signal
  rows keep their identity. Sustained traffic uses the 30 days before the current
  30-day observation period as a frozen baseline, so a month-long rise cannot
  raise its own comparison point. Each of the latest 14 days is compared with a
  threshold derived from the platform P95 growth multiple and P95 absolute
  excess; at least 10 days must exceed that threshold. The same skill must also
  reach a distributed download total within those same 14 days of at least
  6,400 or ten times the platform 30-day download P99, whichever is higher.
  Each day's contribution to this decision is capped at one tenth of that
  required total; reported download counts remain uncapped. Older downloads
  cannot satisfy this gate, and one recent burst cannot turn otherwise modest
  traffic into a sustained signal. Uneven daily traffic may still qualify;
  there is no additional minimum volume required on each abnormal day.
  At most 5 installs are allowed in the 14-day window. The standalone surge
  detector is independent and uses uncapped counts, so one extreme day can
  still trigger a surge signal without qualifying as sustained. These
  volume requirements prevent broad crawler traffic from being presented
  as a publisher-specific anomaly. This
  catches traffic that arrives at a steady, exceptionally high rate after a
  cold start instead of only detecting a spike on the day it begins. These
  signals record anomalous traffic for staff visibility, not publisher
  attribution or an enforcement decision.
- The Signals tab is read-only telemetry. New signal rows do not have snooze,
  dismissal, notification, ownership, or reply state. Legacy temporal
  nominations remain readable and remain ineligible for autoban so existing
  production records survive this rollout; the shared review tables continue
  to serve aggregate pressure scoring. Removing legacy temporal records requires
  a separate, explicitly approved production migration.
- The completed temporal pipeline also checks for publisher-wide synchronization
  among scan candidates that either have a sustained anomaly or clear the lower
  proportional 7-day spike floor plus both platform P99 comparisons.
  The synchronized group must cover at least 15% of the publisher's currently
  published skills and more than half of its eligible scan candidates. Each
  member's normalized trailing 60-day curve must have Pearson correlation of at
  least 0.98 with the portfolio's median normalized curve, and the largest
  seven-day rolling peak must be no more than 1.25 times the smallest. At least
  two skills are required only because a trend comparison needs a group; there
  is no fixed catalogue-size threshold. The full 60-day curve is captured during
  the existing catalogue read and carried in the temporary scan candidate. Synchrony then
  reads those candidates in bounded pages instead of querying each skill again.
  A publisher above 8,000 synchrony candidates is skipped with the structured
  `publisher_temporal_abuse_synchrony_owner_skipped` operator event, and the
  scan continues with later publishers. This bounds one action without turning
  a single oversized portfolio into a terminal full-scan failure.
  Page size never
  becomes an eligibility ceiling, and each publisher is evaluated once per run
  even when its candidates span several source pages. Candidate reads use the
  publisher-and-run index, so retained observations from older runs do not add
  work to the current scan. Median-reference comparison keeps detector work near
  linear as a portfolio grows. This produces one
  `owner_synchronized_download_trends` signal for the publisher, not one extra
  signal per skill. The majority and similar-peak requirements avoid treating a
  small coincidental subset or shared direction alone as evidence.
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
- Publisher abuse Signals are read-only staff telemetry. They must not feed
  automatic ban pressure, create a review queue, notify staff or publishers, or
  expose workflow actions. The Signals view lists every stored observation and
  shows bounded evidence in a detail drawer. For skill-level signals, the drawer
  loads daily downloads and installs for the trailing 30 days from the bounded
  daily-stat index. When a model version renames an equivalent signal type, it
  must reuse the existing row so one observation keeps a stable identity across
  detector versions.
- Every `publisher-abuse-temporal.*` model version, including legacy rows,
  remains ineligible for warning-first automatic enforcement. A future decision
  to enforce temporal traffic signals requires an explicit policy and code
  change; increasing a temporal score cannot silently cross the existing
  pressure-model autoban boundary.
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

## Reporting + moderation review

- Reports are unique per user + target (skill/package).
- Report reason required (trimmed, max 500 chars). Abuse of reporting may result in account bans.
- Per-user cap: 20 **active** reports.
  - Active skill report = skill exists, not soft-deleted, not `moderationStatus = removed`,
    and the owner is not banned.
  - Active package report = package exists, not soft-deleted, and the owner is
    not banned/deactivated.
- Reports never change skill visibility or installability automatically, regardless
  of the number of distinct reporters or whether the skill is official. Report
  submission records moderator intake and updates report counts only. Hiding a
  skill requires an authorized moderator's explicit decision; this prevents a
  small group of ordinary accounts from removing arbitrary catalog entries.
- Existing report, scanner, and moderator hides retain their provenance; this
  change does not automatically restore previously hidden skills.
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
- Successful exact package-release security reads expose the audit page's
  canonical summary-and-guidance copy as top-level `overview` and link the
  exact release through `securityAuditUrl`; neither field changes trust decisions.
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
  the same artifact.
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
  user-submitted upload scans, its completed ClawScan and SkillSpector results
  are persisted on `githubSkillScans` by skill and content hash so the
  public Security audit remains available after request files are pruned through
  bounded continuation batches. Cleanup cancels the linked worker job before
  deleting the first chunk. Legacy source-backed statuses without a durable
  `githubSkillScans` result must return to pending on sync rather than remain
  trusted. Explicit owner/moderator rescans use the manual worker queue.
  GitHub-backed verification must not create or patch a hosted `skillVersions`
  row.
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

## Skill publish upload boundary

- CLI skill publishing stages each file through the direct Convex HTTP surface,
  keeping file bodies off the Vercel request path. Each file remains capped at
  10MB and the complete publish remains capped at 50MB.
- The server creates a short-lived, user-bound ticket before accepting a file.
  The upload action enforces the declared path, byte size, content type, and
  SHA-256 before attaching the resulting storage id to that ticket.
- Storage metadata SHA-256 values may be hex or base64 depending on the Convex
  runtime. Attachment validation compares the decoded digest bytes while the
  ticket and public publish contract remain canonical lowercase hex.
- JSON skill publishes must present the matching ticket for every staged file.
  Ticket ownership and file metadata are revalidated, and ticket consumption is
  committed atomically with the new skill version.
- Unconsumed staged files are deleted when their tickets expire. Failed
  attachment attempts delete the just-created storage blob immediately.

- A captured `CommitterFullError: Too many writes in a short period of time.`
  rejection from `storage.store`, before it returns a storage id, is HTTP 503.
  The shared CLI uses its existing bounded HTTP retry policy. This classification
  is limited to that storage call: validation, ownership, expired/consumed-ticket,
  attachment, and unclassified write failures keep their existing responses.
  Upload limits, deadlines, ticket lifetime, and the post-store lifecycle are
  unchanged. This does not guarantee recovery of a stored blob after an action
  dies or loses its storage response.

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
- The inline multipart budget (`MAX_PACKAGE_MULTIPART_BYTES`) must stay below
  the 4.5 MB request body cap of the Vercel functions that front `clawhub.ai`.
  Anything larger goes through the upload-url flow, which uploads straight to
  Convex storage; the CLI picks the route from the same shared constant.
- Direct package publish multipart bytes are capped at 18MB so callers get a
  clear ClawHub validation error before hitting Convex's 20MB HTTP action body
  cap. ClawPack tarballs keep the 120MB package tarball cap through staged
  storage uploads.
- For tarball uploads, ClawHub stores the uploaded tarball, derives its
  artifact hashes and npm metadata, and derives package file metadata from the
  tarball contents.
- A captured `CommitterFullError: Too many writes in a short period of time.`
  rejection from the first inline ClawPack tarball `storage.store` is HTTP 503
  only before publication dispatch and while the request owns no storage IDs.
  The shared CLI keeps its existing bounded retry policy. Later stores, loose-file
  uploads, staged tarballs, validation and publication failures keep their existing
  classification and cleanup ownership. This does not guarantee recovery of a
  stored blob after a lost storage response or action termination.
- Experimental `family: template` publication requires one already-built npm-pack
  `.tgz` plus the publisher-computed canonical lowercase SHA-256. It must not
  accept source directories, GitHub checkout sources, extracted-file
  publication, or the legacy public-action path. The HTTP boundary recomputes
  the digest from the accepted tarball bytes before creating or reusing any
  release state.
- A Template staged-attempt key binds actor, owner, normalized package name,
  version, and verified tarball digest. Only that exact tuple may reuse an
  active pending attempt or active published release. Different artifacts or
  owners and terminal, soft-deleted, blocked, quarantined, revoked, or
  malicious state whose target still exists must preserve the version conflict
  rather than being reused or discarded. Hard deletion removes package and
  release rows but retains the publish attempt as audit history; an attempt
  whose referenced package or release no longer exists is audit-only and must
  neither reserve that package version nor be reused.
- Template pending and final publication responses expose the verified artifact
  SHA-256. Polling must preserve the same digest, and the package artifact
  download must serve the exact stored tarball bytes whose SHA-256 matches that
  value. Trusted publish tokens accepted by an idempotent retry are revoked on
  the same success boundary as a newly created attempt.
- Every skill and package publish entry point (web actions, CLI and HTTP
  routes, GitHub import, trusted publishing, and managed MCP) stores a pending
  version or release plus a publish attempt bound to the exact artifact
  fingerprint. No deployment toggle or fallback publishes first and scans
  later. Only a passing pre-publication verdict promotes the release. Repeated
  scanner failures terminate the attempt as failed, and a worker whose check
  lease expired cannot submit a verdict, so scanner failures and timeouts leave
  the release unpublished. AI summary, changelog, and embedding generation run
  during finalization, after the checks pass.
- A staged publish attempt is not a successful release. ClawHub dispatches an
  exact pre-publication worker through the production GitHub App as soon as the
  attempt becomes pending; the scheduled worker remains recovery for missed
  dispatches.
- For pending-check and ready-finalization attempts, duplicate targeted recovery
  against a live foreign lease returns no work. It preserves the existing claim
  ID and expiry without falling through to another claim path; the same claim
  may resume its own lease.
- Retriable finalization failures release both the finalization claim and the
  finalization-only worker’s check reservation, so the next worker can retry
  immediately without waiting for the scan lease. Cleanup requires the current
  finalizing status and matching finalization claim ID; stale cleanup must not
  release a replacement worker’s reservation. Passing checks and retained
  artifacts are preserved, and scan lease durations are unchanged.
- An explicitly targeted worker can resume an expired finalizing attempt while
  its retained artifacts remain available and both primary checks have passed.
  Admission validates the same current authority, original scope, inventory,
  storage and moderation boundaries as an operator retry, then atomically adds
  a separate typed finalization-recovery binding and audit receipt. Publication
  revalidates that binding in its final transaction. Preserve scan/advisory
  findings, failure history and original files; never steal a live lease.
  Untargeted discovery is unchanged and does not adopt finalizing attempts.
- Internal operator recovery of terminal operational failures defaults to a dry
  run and requires the observed attempt timestamp and artifact fingerprint.
  Admission rechecks the original actor's current publisher permission without
  a platform-admin bypass, the original owner/scope and staged target, every
  retained immutable storage object, live leases and moderation holds. A retry
  audits the prior checks/error/count and requeues the same attempt; it cannot
  replace bytes, lift a hold, declare a clean verdict or reset failure history.
- An audited operator retry may require an exact reviewed scanner source (40
  lowercase Git hex characters). Omitting the option preserves an existing
  requirement. Pending-check workers with an omitted or different source must
  leave that attempt untouched and may claim unrelated work. Existing live
  leases and finalization-only recovery keep their existing rules. The latest
  accepted scan lease records its claim ID, worker-reported source and time;
  this is attribution, not cryptographic attestation, and does not assert a
  successful scan. A new unreported scan lease clears stale attribution.
  Deploy backend support before enabling the repository Actions variable
  `PREPUBLICATION_REPORT_SCANNER_SOURCE` (default `false`). When enabled, workers
  verify the reviewed pin against a clean checkout and Go binary revision, use
  that exact installed host binary, and report the source on scan claims.
- An applied operational retry writes a typed binding on the retained version
  or release: original attempt, actor, current validated owner and publisher
  scope. The final publication transaction must validate that binding, original
  target/inventory/fingerprint/archive, passing primary checks, live finalization
  lease, current actor membership, active owner/publisher and current moderation.
  Membership revocation, ownership changes, deletion, security redaction, manual
  revocation/quarantine or a malicious verdict during scanning must prevent
  promotion. Legacy attempts lacking an owner-user snapshot may bind the
  validated organization owner once; later retries cannot change that binding.
  Existing pending rows need no backfill: the binding is added atomically only
  when an eligible retry is applied. Preserve original storage IDs, digests,
  staged identity and all existing scanner and trusted-publisher boundaries.
  A later authenticated package-recovery successor validates and atomically
  retires its failed predecessor's operational binding, retaining that binding
  in the recovery audit. Its existing fresh manual authority and final-publication
  checks then govern the successor; it must not inherit a failed predecessor's
  finalization claim or bypass revocation checks.
- Authenticated package publishers can read only their own exact publish
  attempt, or the exact package and version authorized by a GitHub Actions
  publish token. The response exposes one normalized pending, published,
  blocked, failed, or expired publication state without exposing another
  publisher's attempt identifiers or scan details.
- Release automation must wait for the authoritative attempt to become
  published or terminally fail. A pending upload response alone must never make
  a package publication workflow succeed.

## Skill moderation pipeline

- Deploy optional backend receiving, schema, storage, and finalization support
  before shipping workers that send `inspectionStatus` or prepublication
  `skillSpectorAnalysis`; older Convex object validators reject unknown fields.
  Keep existing workers and the native scanner pin unchanged for that first
  deployment, and continue accepting requests that omit the new fields.
  Inspection completeness (`completed` or `partial`) remains independent of
  risk status and never bypasses existing judge, receipt, scanner, or publication
  gates. Ship the worker policy layer only after the backend deployment.
- ClawHub's in-publish static scan is retired. It ran out of memory on large
  (~1,800-file) plugin packages and duplicated the ClawScan pre-publication gate.
  Skill, package, package-backfill and GitHub-backed publishes no longer compute
  or store `staticScan`, ClawScan workers no longer receive it as context, and no
  UI, CLI, verification, scan-report, or audit-export surface displays it.
  Historical `staticScan` rows remain in the database but are not read, with
  one legacy exception: the package trust resolver still ignores a
  `verification.scanStatus` that only mirrors a stored static result, so old
  static-derived statuses cannot start acting as trust verdicts. The fields stay
  optional in the schema until a migration clears historical rows.
- Skill Card generation waits only for a settled ClawScan verdict; it no longer
  waits for a static scan.
- Public artifact pages present SkillSpector findings, A.I.G findings for skills,
  and ClawScan-powered risk review as one consolidated Security audit page.
  This is a product-facing model only; scanner storage, moderation decisions,
  and worker behavior remain separate internally.
- Scanner finding content is source evidence, not the verdict or necessarily
  only the matched risky text. SkillSpector preserves scanner-provided excerpts
  ahead of source-file fallbacks and labels their provenance. Fallbacks render
  the full reported line range, labeled with the file path and displayed range.
  They must not present a bare Markdown frontmatter delimiter as evidence; if the
  available source is shorter than the reported range, disclose it. Source code
  remains literal and uses syntax highlighting; scanner Markdown uses the sanitized report renderer.
  SkillSpector details appear as Category, Confidence, Finding, then Content.
  A.I.G shows concise labeled facts with long analysis and remediation collapsed
  until requested; disclosure does not alter the stored report or scanner verdict.
- ClawScan verdicts come from a GitHub Actions Codex worker, not a single
  hosted LLM call. Codex reviews the materialized artifact workspace with
  SkillSpector and A.I.G evidence as context.
- Workers preserve explicitly configured model and reasoning settings through
  restricted scanner subprocess environments. Workflow defaults and pinned
  scanner versions define the active policy; forwarding optional settings
  does not change those defaults or add support to older scanner clients.
- ClawScan is the sole authority for the stored risk-analysis verdict and its
  moderation consequences. A.I.G is required supporting evidence for skill
  scans: missing, failed, or malformed A.I.G output fails the worker through
  the normal retry lifecycle, but an A.I.G finding never independently blocks,
  hides, or changes installability. Package releases skip the skill-only A.I.G
  scanner.
- SkillSpector coverage may remain partial when its execution produced usable
  evidence. Both worker consumers accept only native `skillspector.status=partial`
  with `reportPolicy=judge-gaps`, successful structured report evidence, and a
  completed independent ClawScan judge with a valid v2 artifact-inspection
  receipt matching the final native attempt. Preserve coverage gaps and findings;
  no coverage percentage or exhaustive gap inspection is an admission gate.
  Missing/malformed/unsuccessful scanner evidence, process failure, invalid
  receipts, and failed judges still fail through the ordinary retry lifecycle.
  Benign and suspicious judge verdicts retain their existing publication and
  warning semantics; malicious verdicts block. Prepublication completion retains
  the normalized SkillSpector findings on both skill versions and plugin releases
  through finalization, alongside judge and A.I.G evidence. Optional
  `inspectionStatus=completed|partial` preserves explicit raw completeness
  separately from risk `status`; absent completeness stays unknown. A benign
  judge does not erase partial inspection provenance. Secret and unsafe
  bytecode rejection remain independent gates.
- A completed native SkillSpector invocation may exit 1 because it found issues,
  retaining the native `exit status 1` diagnostic and stderr. Typed worker
  consumers accept that findings exit only with actual command/timing provenance,
  a nonempty usable findings report explicitly declaring successful execution,
  and explicit successful, complete accounting. Unknown process errors, crash
  exits, unsuccessful/malformed evidence, missing required scanners and failed
  judges still fail closed. The original report and process diagnostics remain
  unchanged; the completed independent judge remains the risk authority, so
  malicious still blocks and suspicious retains its warning semantics.
- Published skill verification retains complete upstream A.I.G and SkillSpector
  JSON in a version-owned storage blob, separate from capped database summaries.
  `/verify` returns these reports under `security.scannerReports`, alongside the
  overall verdict and without duplicate signal summaries, only when their scan timestamp matches all
  stored summaries and the ClawScan verdict. Legacy scans expose null reports
  until rescanned; raw evidence never changes moderation or verification policy.
  Replacing a scan deletes its previous report blob, and version hard deletion
  or pending-publication discard deletes the associated blob. Workers send raw
  reports only when the hydrated job provides a signed upload URL, so merging
  the worker before a separate Convex deployment does not break scan completion.
  Raw JSON uploads directly to storage; completion receives only a storage ID,
  avoiding Convex function-argument size and value-encoding limits.
- Production workers install A.I.G and its complete Python dependency set from
  the reviewed, hash-locked worker requirements file. Updating the scanner or a
  dependency requires an explicit lock update; a mutable package-index artifact
  must not enter a credentialed scan worker.
- A.I.G 0.2.1 is affected by CVE-2026-84809 and cannot inspect packaged Python
  bytecode. While that version remains pinned, both worker paths must reject
  skill targets containing `.pyc`, `.pyo`, or `.pyd` files before invoking
  A.I.G. ClawScan's static scanner independently flags packaged Python bytecode,
  but that defense does not remove the worker-boundary rejection requirement.
- In the external Codex security worker, package-release SkillSpector runs scan
  only normalized bundled-skill roots declared by the stored plugin manifest
  summary. The plugin package root is never a fallback SkillSpector target;
  packages with no bundled roots provide ClawScan an explicit not-applicable
  result. This is not a prepublication-worker contract.
- Current skill and plugin scans are queued through `securityScanJobs` and
  completed by the external Codex worker.
- VirusTotal is retired. ClawHub no longer uploads skill ZIPs or package
  artifacts to VirusTotal, polls or backfills VirusTotal results, re-queues
  ClawScan from VirusTotal updates (`vt-update`), delays ClawScan jobs waiting
  for VirusTotal, or looks up VirusTotal credentials. No UI, CLI, public API,
  verification, scan-report, or audit-export surface shows VirusTotal data, and
  VirusTotal status never affects moderation reasons, listing, or trust.
  Historical `vtAnalysis`, `vtScanLogs`, `scanLastCheckedAt`/`scanCheckCount`
  and `securityScanJobs.waitForVtUntil` values remain in the database only until a
  follow-up migration narrows the schema. The unused production
  `skillVersions.by_active_vt_status_created` index is retained as deployment
  compatibility until a separately approved cleanup; this does not re-enable
  any VirusTotal reader, writer, scheduler, or trust decision. Queued legacy `vt-update` jobs still
  drain through the normal claim path. ClawScan workers keep stripping
  `VIRUSTOTAL_API_KEY` from scanner subprocesses so the OSS ClawScan VirusTotal
  scanner can never activate from a stray runner secret.
- The skill-version `sha256hash` (deterministic ZIP hash used for hosted catalog
  integrity, Skill Cards, and verification) used to be computed by the VirusTotal
  upload. Publish finalization now schedules a dedicated hash action with the same
  ZIP inputs, so the value stays byte-identical to historical hashes. Versions
  that never received a hash (VirusTotal jobs still queued at retirement, or a
  failed hash action) are repaired by the operator-run
  `skillVersionArtifactHash:backfillMissingSkillVersionArtifactHashesInternal`.
- Legacy moderation reasons stamped by retired scanners (`scanner.vt.*`,
  `scanner.vt-rescan.*`, `scanner.static.*`) are never written anymore. The
  latest-version moderation backfill treats them as stale and rebuilds those rows
  from ClawScan. Until that operator backfill runs, a stored `scanner.vt.pending`
  still reads as pending (fail closed) so the retirement deploy does not newly
  expose skills whose latest version has no settled ClawScan result.
- Search digests (`skillSearchDigest.publicVersion`) computed before the
  retirement may still mark versions unavailable because of a VirusTotal or
  static result. That is fail-closed; digests refresh on the next skill/version
  change or an operator digest resync.
- ClawScan is the only scanner result that gates public listing of a skill version
  (pending/not-run holds, malicious blocks). Stored VirusTotal or static results on
  older versions no longer hold or block listing.
- Lifting a publisher moderation hold restores a skill from its latest version's
  ClawScan result. A latest version without a completed ClawScan result stays
  `pending.scan` and gets a ClawScan `backfill` job; retired VirusTotal results no
  longer count as a completed scan.
- The offline security-dataset export still serializes historical `vtAnalysis` and
  `staticScan` columns from stored rows. Changing that public dataset schema is a
  separate follow-up; it does not call VirusTotal or the static scanner.
- The worker's explicit artifact-only OSS ClawScan route accepts every claimed
  target kind and source through the same completion/failure contract. Skill
  versions and scan requests use the isolated `artifact` root; extracted
  ClawPack releases use `artifact/package`.
- Both workers disambiguate directories containing `SKILL.md` and
  `openclaw.plugin.json` by selecting the manifest matching the claimed target
  kind. ClawScan still scans the full directory. Single-manifest directory
  scans and the separate bundled-SkillSpector directory base remain unchanged.
- OSS ClawScan is the only security-scan implementation. Every claimed target
  kind and source runs through the same ClawScan profile and completion/failure
  contract. ClawScan failures use the existing failure/retry lifecycle; there
  is no per-job fallback or alternate legacy route.
- On Unix runners, ClawScan commands run in isolated process groups. A timeout
  must terminate the full process group so surviving scanner or judge
  descendants cannot hold a worker slot after the timeout is recorded.
- The production scan-worker timeout defaults to 15 minutes. Package-release
  SkillSpector runs can validly exceed four minutes, so a lower timeout must not
  be used as the normal capacity control.
- A ClawScan judge result is complete only when ClawScan verifies
  a workspace-only inspection challenge and the SHA-256 of a required artifact
  file. Missing or mismatched inspection receipts fail the judge and use the
  normal scan failure/retry lifecycle; a low-confidence verdict cannot replace
  successful artifact inspection.
- Manual prepublication recovery uses the existing Blacksmith runner or pinned
  GitHub-hosted Ubuntu 22.04. Ubuntu 24.04 fails the current judge's nested
  bubblewrap setup with `RTM_NEWADDR: Operation not permitted`; switching to
  `ubuntu-latest` must require a passing real judge inspection proof first.
  Recovery must preserve the read-only judge sandbox and inspection receipt checks.
- Every worker run publishes a GitHub Actions summary and uploads a structured
  summary with its secret-scanned diagnostics. The summary reports ClawScan
  completions, failures, timeouts, scanner-stage and judge-stage failures,
  duration, throughput, queue health, and verdict totals. Queue-health lookup
  failures are diagnostic-only and must not change persistence, retries, or the
  worker exit result.
- Retained worker diagnostics preserve complete redacted ClawScan artifacts and
  per-scanner outputs without per-file or aggregate-size truncation. Bounded
  metadata/error fields may remain capped. Artifact upload still requires the
  existing verified-secret scan to pass.
- The separate fixed original038 diagnostic permits one fresh Ubuntu 22.04 X64
  run against the exact merged source, production dependencies and normal full
  profile. It verifies every retained original file from the anonymous download;
  the generated ZIP is a transfer container, not the original immutable archive.
  Synchronous scanner/judge captures preserve reports, streams, gaps and receipts
  before native cleanup. Existing injected-credential redaction/withholding and
  a final plaintext evidence check remain mandatory. Only checksum-pinned age
  ciphertext and bounded metadata may enter Actions artifacts; the per-run private
  identity stays with the consuming controller. Failed encryption, secret checks
  or unconfirmed process cleanup prevent upload. Capture completeness and scanner
  coverage remain separate. A fully captured operational failure still fails the
  diagnostic job; normal accepted partial or suspicious results need not be benign
  or claim complete scanner coverage. The fixed038 run name binds the public age
  recipient even when no artifact is uploaded. This nonpublishing diagnostic adds
  no recovery count or retry authority.
- The manual diagnostic workflow always dispatches from `main`. Its default
  `consumer: workflow` executes that workflow revision. The bounded
  `consumer: recovery-approved` mode instead checks out the reviewed immutable
  consumer `2db6eef5df3229741d22aa659d60057d17c8a2a2`; it accepts no caller-supplied
  commit. In `recovery-approved` mode, both the original and triggering actors
  must be `Patrick-Erichsen`,
  the run must be its first attempt, and inputs must select one of the 32 explicit
  encrypted selectors: separate originals `038` and `079`, plus the 30 admitted
  skill originals `004`, `016`, `017`, `026`, `027`, `074`, `008`, `011`, `036`,
  `033`, `065`, `073`, `042`, `055`, `039`, `010`, `019`, `005`, `006`, `015`,
  `071`, `007`, `009`, `014`, `013`, `029`, `030`, `002`, `003` and `067`.
  Inputs must also select reviewed scanner source and Ubuntu 22.04. Before
  checkout, inline trusted workflow code verifies the repository, main workflow
  identity and consumer ancestry. The actual checkout must then equal the approved consumer
  before local actions or any provider credential is exposed. A failed guard
  must prevent the credentialed diagnostic command from running.
  Diagnostic scheduling has exactly two server concurrency lanes, `0` and `1`,
  with `0` as the default. The concurrency expression clamps every dispatch to
  those two group keys; inline validation rejects other lane values before
  checkout or provider credentials. Ordinary `consumer: workflow` controls stay
  on lane `0`; only the guarded recovery mode may use lane `1`.
  A root-approved parent may hold at most two in-flight original controllers,
  one separate process and ephemeral recipient per case and occupied lane. It
  must reconcile active ownership and current canonical identity/security state
  before admission and never dispatch another case to an occupied lane. Queued,
  waiting and running owned jobs all occupy a lane. GitHub's default pending
  replacement is not a durable queue; `cancel-in-progress: false` alone does not
  preserve multiple pending runs. Stop new admissions on failures or unknown
  operations, while retaining the keys and collecting peers already in flight.
  Use the exact GitHub dispatch response run ID, retaining all existing
  recipient, actor, source, artifact and evidence checks. An uncertain POST must
  never be repeated; existing bounded recipient discovery may collect its one
  result. Concurrency adds no retries, new selectors, source advancement,
  publication authority or relaxed security review. A newly approved workflow
  still requires one fully collected and audited canary before a bounded pair.
  Record workflow revision W and executable consumer C separately. Controllers
  may admit an advanced W only with the same approved workflow bytes and valid
  C ancestry; C remains fixed. This exception does not imply that all
  application code on W has been qualified. Changing C requires a normal reviewed
  workflow change, fresh exact-source/runtime qualification, and matching
  controller, auditor and approval bindings; never advance it
  implicitly to follow main. Recovery controllers must approve the entire workflow
  content and reject changed workflow bytes until reviewed. The fixed consumer
  retains the original hashes, encrypted capture, scanner/judge settings,
  inspection receipts and nonpublishing boundary. This mode grants no publication,
  retry, security bypass or issue-closeout authority.
  New fixed-original registry admissions do not extend the older pinned consumer's
  closed selector set. Until a new merged consumer is qualified, those selectors
  may use only `consumer: workflow`. Keep active recovery workflows and their
  approved bytes stable; finish those runs before deploying admission changes.
  Then qualify the merged admission revision and update the fixed pin, closed
  selectors and controller/auditor bindings in a separate reviewed change.
  Never send a new selector to an older pin or fall back to an arbitrary commit.
- The native prepublication failure event preserves the existing SkillSpector
  projection and adds only fixed scanner names, allowlisted status/error classes,
  bounded exit/timing numbers, and presence/byte-count/SHA-256 metadata. Arbitrary
  error text, command arguments, paths, raw reports, and subprocess streams must
  not enter this event. Artifact hashes cover original bytes; scanner raw hashes
  cover parsed JSON serialization. Missing, unreadable, malformed, and wrong-schema
  artifacts remain failed and emit metadata without trusting their scanner fields.
  This event does not provide private full-report retention or adapter command-boundary
  capture; both remain separate unresolved work before temporary outputs are deleted.
- SkillSpector starts from its upstream locked environment. Until that lock
  includes the deferred-model serialization repair, replace only Pydantic and
  pydantic-core and their required typing dependencies with the reviewed
  hash-locked binary-wheel set. Do not resolve unrelated dependency upgrades.
  Before scanning, the actual worker environment
  must serialize a genuinely cold finding subtype with every finding field
  preserved and still reject invalid findings and unresolved models. Run the
  existing adapter checks and dependency-consistency check afterward. This
  repairs serialization mechanics; it does not establish package recovery or
  change scanner completeness, findings, retries, or publication gates.
  Copied diagnostic installer bundles must include the compatibility requirements
  and startup probe, record their hashes, and distinguish the compatibility set
  from the unchanged upstream lock.
- The fixed Solaris exception diagnostic is a separate, nonpublishing manual
  workflow on `main`, admitted only on the qualified GitHub-hosted Ubuntu 22.04
  runner with the fixed source, original-byte inventory, model policy and scan
  budgets. It accepts no dispatch inputs or arbitrary targets. Original root 28
  runs first; all 62 roots run only after that job succeeds with complete observer
  evidence. It cannot claim queue work, invoke the judge, retry a publication or
  write publication state, and it never executes publisher code.
  The observer verifies the pinned analyzer source and invokes the installed CLI
  and interpreter. It calls the original failure classifier first and preserves
  its result, exceptions and retry behavior. Exported exception data is limited
  to fixed module IDs, qualified line numbers, allowlisted classes, bounded HTTP
  status codes, root indices, counts and lifecycle flags. One boolean may identify
  the exact known Pydantic MockValSer/SchemaSerializer TypeError; matching must
  inspect only its single string argument without stringifying arbitrary values
  or exporting any message text. Only a qualified Pydantic `model_dump` frame may
  provide fixed enums for response family and serializer kind, plus whether the
  model is built. These come from class dictionaries without calling properties
  or serializers.
  TypeError argument metadata is capped at three primitive-type labels. Up to 23
  fixed public error/type tokens may be recognized in a sole built-in string
  argument of at most 2,048 characters; unknown text is always discarded. These
  tokens classify known vocabulary rather than exporting message fragments.
  Frame provenance must match the loaded module's globals and source filename.
  Export limits are three
  chained exceptions, eight frames per exception and eight failure records per
  root; traversal is capped at 64 frames, line numbers at 1,000,000 and the private
  event file at 2 MiB/1,024 records. Reaching a limit that loses observer records
  cannot produce a successful diagnostic. Messages, provider bodies, raw paths,
  source text, findings and credentials must never enter exported summaries or
  logs. The reader reprojects allowed fields from a private regular file and
  rejects symlinks, insecure permissions, malformed data and incomplete lifecycle
  or count evidence. Private raw reports, events, scratch and source are removed
  after readers settle; only the restricted summary may be uploaded. Diagnostic
  success is neither publication acceptance nor proof of recovery or unblocking;
  normal scanner, judge and package-specific live verification remain required.
- Claimable queue work edge-triggers a coalesced GitHub Actions worker dispatch.
  Successful completion requests another dispatch while queued work remains; a
  five-minute Convex cron is only a recovery watchdog for lost dispatch signals.
  Convex emits the narrowly typed `clawhub-security-scan`
  `repository_dispatch` event using the production GitHub App. Event-driven
  dispatch stays disabled until that installation is verified to have Contents
  write permission. GitHub Actions concurrency is scoped per worker shard so a
  delayed runner allocation cannot block every shard; each shard still keeps at
  most one running and one pending drain wave.
- Queue source priority is `manual`, `backfill`, `publish`, the retired legacy
  `vt-update`, then `bulk-rescan`. New jobs are claimable immediately; nothing
  waits for an external reputation result.
- Bulk rescans stay lowest priority and use the bounded operator campaign flow,
  which enqueues one page at a time and waits for that page before continuing.
- The plugin bulk rescan command scans only the latest active release of code/bundle
  plugins, preserving existing active jobs and manual moderation decisions. It
  skips deleted/revoked releases, uses stable creation-order catalog pagination,
  and caps each transaction at 10 package rows to bound release hydration. Admin
  identity comes from the authenticated API token, and applied batches are audited.
  Dry runs create neither jobs nor batch audit entries. Existing scanner results
  do not exclude a release; this supports scanner-version and AIG backfills.
- ClawScan worker concurrency is an operator-controlled compute concern. The
  backend claim path must cap only a single worker claim size and must not impose
  a global active-scan ceiling; horizontal capacity is controlled by worker
  dispatch count, worker batch limit, provider quotas, and cost monitoring.
- Local bulk campaigns may assign disjoint lists of existing job IDs to shared
  worker shards. Assigned claims read only those IDs, accept only queued, due,
  ungated `bulk-rescan` skill-version jobs, and use the normal lease, hydration,
  scan and result paths. They must not fall back to the general queue when an
  assignment is empty or stale, claim package jobs, or retry terminal failures.
  Assigned shared workers use separate GitHub concurrency groups from ordinary
  queue workers, so a slow general-queue wave cannot block local bulk assignments.
  Each assigned shard still permits only one running and one pending worker.
  The dedicated priority shard remains unassigned, retains its normal queue, and
  uses the same reserved concurrency group for every dispatch mode. Drain assigned
  workers and pending assigned dispatches before changing their group naming.
  Assignment plans, admission baselines, receipts, cursor and capacity control
  remain local; no server-side campaign coordinator or assignment table is added.
  Admin batch status exposes queued identities from the same bounded point reads
  as its counts, so completed jobs in partial batches cannot fill the local
  assignment payload. This is an observation; claims still recheck eligibility.
  The local planner may select nine or eighteen shared worker machines separately
  from per-worker scan concurrency. Default queue dispatches retain nine shared
  workers and one reserved priority worker. Changing pool size requires draining
  the previous shared pool because stable hashing depends on pool size. A worker
  must reject an assignment count that differs from its dispatched pool size
  before claiming any shared job; priority work remains independent of that check.
- Normal scan claims read only enough ready queue rows to fill the worker's
  remaining capacity. Broader pagination is reserved for skipping blocked legacy
  GitHub jobs or the catalog lane's bounded admission window; disabling a rollout
  must not make every native one-job claim read hundreds of unrelated jobs.
- The Skill Card verification envelope exposes ClawScan as the top-level
  `security` verdict for install automation, with deterministic and third-party
  scanner evidence grouped under `security.signals`. Clients should key install
  decisions off `ok`, `decision`, `reasons`, and `security.status` instead of
  re-deriving trust from individual signal payloads.
- Skill Card completion owns a newly stored card until its attachment mutation succeeds. If attachment rejects a stale lease or unavailable version, delete only that new blob and preserve the original error if cleanup fails. Successful replacement retains prior card blobs and generated bundle fingerprints so existing installs remain resolvable.
- Skill Card workers default to GPT-6 Luna with medium reasoning and the Standard
  service tier. Recipe-hash claims remain inactive until the separate activation after
  [backend deployment](deploy.md). Once activated, the backend binds each lease before
  generation to the source file hashes,
  server evidence, and worker recipe (model, effort, tier, prompt, template, and
  trusted NVIDIA generator bytes). A completed card is reused only when those
  semantic inputs and the attached card SHA still match. Fresh scan timestamps and
  storage URLs do not invalidate reuse. Completion rereads the same evidence in its
  transaction: changed inputs requeue the job with a fresh attempt budget and delete
  the unattached output. Reuse and deferred-input receipts count toward the existing
  worker max-jobs bound and keep later batches discoverable.
- Exact-version security verdict reads preserve the complete skill identity.
  Batch callers may qualify a request with the publisher handle; owner, slug,
  and version form the dedupe identity, and qualified success or failure results
  echo the normalized requested owner. Unqualified reads retain legacy slug
  resolution, including fail-closed ambiguity, for older clients.
- Successful exact-version security verdicts expose the audit page's canonical
  summary-and-guidance copy as top-level `overview`; install clients consume that
  field instead of reconstructing audit text from scanner details.
- Security verdicts are version-scoped scanner results. ClawHub has no manual
  trust override: staff moderation may change availability or resolve an appeal,
  but it must not replace a version's scanner verdict or let a later publish
  inherit an earlier review decision. Historical staff actions remain in the
  audit log only.
- ClawScan verdicts treat purpose-aligned notes as user guidance, not a
  suspicious verdict. Medium-only material concerns are visible
  `flagged.review` guidance and must not set `isSuspicious`; high or critical
  concerns remain `flagged.suspicious` and are hidden by the suspicious filter.
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
- Security workers back off and retry a transient claim API failure up to three
  times before draining their existing leases. Every failed call remains in
  claim-health counters, and the claim window/max-jobs limits still apply.
  This does not retry terminal scan failures or change their job identities.
  Authentication/validation failures do not enter this transient retry path.
- Recoverable bulk skill requests use administrator-scoped request IDs. Their
  job identities, cursor boundary and counters commit atomically in the permanent
  batch audit entry. An identical replay returns that receipt before traversing
  current skills, even after completion or permanent failure; it must not create
  replacement jobs. Conflicting reuse fails. Optional ordered version baselines
  reject page drift atomically. Legacy batches without receipt IDs require
  read-only, fully paginated exact-version job reconciliation before admission.
- The package/plugin scan backfill only queues ClawScan for published releases with a missing or
  errored ClawScan result. It no longer schedules static scans or VirusTotal uploads.
- `packages.backfillLatestPackageScanStatus` is an admin-only catalog maintenance entry point.
  Anonymous callers and signed-in non-admins are rejected before any package, release, or
  search-digest write. An admin call runs the internal paged mutation, which patches drifted
  scan status and schedules the next batch until the catalog page is done.
- ClawPack package releases materialize parsed npm-pack artifact entries into the release file
  surface. LLM review, package inspect/file APIs, and Codex package ClawScan use those
  stored artifact entries instead of metadata-only `package.json` / `openclaw.plugin.json` rows.
  ClawHub retains the stored ClawPack artifact so scanner workers can download/extract it for
  artifact-backed review.
- Package publication verifies every stored file's bytes, size and SHA-256 before admission.
  Verification reads and hashing run in batches of at most 16, preserving manifest order and
  legacy ZIP input bytes. If a file is missing or a read/hash fails, drain the already-started
  batch and reject before starting another batch; never accept caller-supplied hashes as a
  fallback. This bounds verification I/O, not total retained archive memory, and does not
  retry publication or bypass ownership, inventory authorization or security scans.
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

## Managed company MCP wrappers

Admin-managed MCP packages use ordinary package releases as their authority. Both management UI and admin CLI require an active administrator and normal OpenClaw organization publishing access, including definition reads and unpublication. They cannot replace unrelated package identities. Each edit creates a new immutable version; unpublication uses the existing package policy and checks current administrator, publisher, and membership authority in the same transaction as soft deletion. Finalizing a queued managed release rechecks the submitting administrator, the active OpenClaw publisher, and current publishing membership in the same transaction that makes the release public. Revocation while scans run must leave the release unavailable.

Generated wrappers accept only remote public HTTPS HTTP/SSE connections, current categories, credential placeholders, and PNG icons with attribution and explicit rights metadata. Wrapper code remains MIT-licensed; company artwork can have separate terms and must not inherit that license. Non-MIT icons require public HTTPS source and terms URLs, and the publishing operator must verify permission to redistribute the asset. Recording those URLs does not itself grant permission. They contain no arbitrary local commands or fetched provider code. OpenClaw wrapper authorship is distinct from remote-service ownership.

Managed publication always enters the ordinary staged security pipeline. Neither admin authorship nor the `@openclaw` namespace grants trusted-package scan exemption; subsequent ordinary submissions retaining the managed definition marker also remain subject to checks. A successful package scan says nothing about the remote service's current or future tools.

Public MCP inspection resolves a server from an accessible immutable release, never a caller-supplied URL. It pins public DNS destinations, rejects private addresses and credential-bearing URLs, never follows redirects, limits bytes and time, and uses an endpoint rate limit. It does not authenticate, register OAuth clients, follow legacy SSE session endpoints, or execute tools. OAuth authoring checks require public authorization/token endpoints and retain issuer and PKCE validation. The default identity path still requires a public DCR registration endpoint. Explicit CIMD authoring is accepted only when discovery advertises the boolean `client_id_metadata_document_supported: true` and the authored public HTTPS non-root client URL returns a bounded JSON document whose `client_id` exactly matches that URL, with a nonempty client name and usable redirect URIs. CIMD identifiers reject dot path segments; documents reject client secrets and shared-secret authentication methods. The client document uses the same public-DNS-pinned, no-redirect request path, without credentials; callback URIs are never fetched. Explicit CIMD must not silently fall back to a DCR identity. Scope and client metadata URL remain in immutable bundle/managed-definition bytes. These observations do not imply domain control, consumer callback or client-auth compatibility, or completed account testing.
