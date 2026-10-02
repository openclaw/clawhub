# Endor in the plugin scan pipeline

## Intent

Plugin publication and rescan requests enqueue work and return without waiting for
Endor's dependency and function-reachability analysis. Endor runs in the existing
ClawHub security worker before a single ClawScan invocation. There is one queue,
one lease per release scan, one ClawScan judge, and one completion submission.

New publications, owner-requested rescans, and admin bulk plugin rescans all use
this path. The existing dispatch watchdog and expired-lease recovery service the
queue. This change does not add a periodic full-catalog LLM rescan. Existing
plugins can be queued through the admin plugin bulk-rescan command, which already
supports paced batches and preserves active jobs.

## Result contract

- Apply Endor to package-release jobs. Skill scans keep their existing scanner set.
- Run the ClawHub-owned Endor wrapper in a dedicated Docker container. Pass its
  bounded result through ClawScan's native `--scanner-result` input alongside
  SkillSpector and ClawScan static evidence. The custom `clawhub` profile keeps
  the existing judge workspace and artifact-inspection contract while explicitly
  putting Endor's result in the one judge prompt. Pass sanitized job, package,
  and policy metadata through ClawScan's `--context` so the judge receives it as
  `metadata.json`. Omit the release's stored Endor summary from that metadata:
  the judge must see only this run's result, so an earlier completed scan cannot
  contradict a failed or skipped one.
- The ClawHub judge decides the existing moderation verdict from the totality of
  artifact and scanner evidence. A dependency vulnerability is supplemental
  evidence; it does not independently quarantine a package or change its download
  policy.
- Display only findings tagged `FINDING_TAGS_REACHABLE_FUNCTION`. A reachable
  dependency or a potentially reachable function does not satisfy that filter.
- Store a bounded summary on the exact package release. Keep the total count
  when the displayed list is capped. Package jobs do not upload or retain full
  scanner reports; worker diagnostics remain bounded and redacted.
- An unsupported package is explicitly not analyzed. A scanner-analysis failure is saved
  as a failed analysis with a safe reason, never a successful empty report.
  The failed or skipped status also reaches the judge; it cannot appear as a clean
  scan. The moderation result still completes and can quarantine the release.
  Scanner-analysis failures do not retry the whole job; owners or admins can
  request a rescan. Primary scanner failures retain the existing job
  failure/retry path. Container ownership or cleanup failures are fatal to the
  worker: do not run the judge, fail the job through the existing failure
  handler, stop claiming work, and preserve the mounted workspace rather than
  delete files while the container may still be using it.
- Preserve the last stored result while replacement work is queued or running.
  Its check time identifies the analysis being displayed.
- Prepare Endor and bundled SkillSpector concurrently after materializing the
  artifact. Wait for both, including Endor's Docker cleanup, before starting the
  single ClawScan judge or deleting the workspace if preparation fails. The
  ClawScan subprocess never receives Endor credentials.

The immutable uploaded artifact remains the source of truth. Endor's disposable
copy may normalize an npm shrinkwrap filename and remove unresolved workspace
development dependencies. Runtime dependencies remain unchanged.

## Hosted rollout

The worker is off for Endor until `CODEX_SECURITY_SCAN_ENDOR_ENABLED=1` is set.
Enable it only after the backend result contract is deployed and the following
worker configuration is available:

- `CODEX_SECURITY_SCAN_CLAWSCAN_VERSION`: an exact released ClawScan version with
  custom profiles and scanner-result injection. The default is `0.2.0`. Endor
  needs no built-in adapter.
- `CODEX_SECURITY_SCAN_ENDOR_IMAGE`: the Endor scanner Docker image pinned by its
  SHA-256 digest. Run the manual `Endor Scanner Image` workflow from `main` to
  publish `ghcr.io/openclaw/clawhub-endor`; copy the digest from its job summary.
  It builds `scripts/security/endor/Dockerfile` with the pinned Endor CLI and
  verifies its checksum. The package must grant this repository Actions access.
- `ENDOR_NAMESPACE` and the `ENDOR_API_CREDENTIALS_KEY` /
  `ENDOR_API_CREDENTIALS_SECRET` secrets. `ENDOR_API` is optional.

The worker authenticates to GHCR with its read-only package token, pulls the
pinned image, and removes that login before claiming work.
The hosted job has a 60-minute timeout. Its 12-minute claim window plus the
longer of Endor's 20-minute and SkillSpector's 15-minute preparation deadlines,
then ClawScan's 15-minute deadline, can reach 47 minutes before setup and
cleanup. The 60-minute job lease still exceeds an individual scan's 35-minute
scanner and judge budget.
The worker writes a trusted ClawHub profile and prompt outside the submitted
artifact. Endor credentials are available only to the worker step and dedicated
Endor subprocess; the ClawScan judge and other scanners do not inherit them.

The wrapper isolates npm/Yarn from scanner credentials, disables dependency
scripts and target-selected Yarn executables, rejects `.npmrc`, and scans a fresh
Git snapshot. It preserves findings JSON, converts successful empty output to an
empty report, accepts Endor's policy exit 128, and rejects analysis errors even
when Endor exits zero. The image retains the reviewed npm version that prevents
Git dependency prepare scripts from bypassing script suppression. The dedicated
container uses destination firewall rules to block private, link-local, and
special-use IPv4 and IPv6 destinations during dependency resolution, then drops
all capabilities and runs the scanner as the image's unprivileged `node` user.
The worker grants network-admin capabilities only so the container can install
those rules before scanning; image workflows verify the rules and privilege
drop on a Linux Docker runner.

Image publication, hosted configuration, and ClawHub deployment remain separate
manual rollout actions.

### Deployment and rollback order

1. Deploy the additive backend schema and result handlers first. Existing
   releases without Endor fields remain readable, and workers that omit Endor
   results can still complete jobs.
2. Configure the released scanner version, image digest, and credentials while
   Endor remains disabled. Enable it for a small plugin batch, then inspect the
   stored summaries, failures, and queue health before expanding.
3. To stop Endor, disable the worker flag and allow active jobs to finish or stop
   their workers. Keep the additive backend schema and result handlers deployed.
   The fields remain readable; later scans replace the release's current summary.
   This is not a report history archive.

Do not redeploy the old backend schema after an Endor result has been stored.
Convex rejects those documents because the old schema does not accept
`endorAnalysis`. A complete backend rollback needs
a revision that retains these optional fields and the compatible result
handlers. Do not delete stored results just to make the old schema deployable.

Endor runs with `--dry-run`; the plugin audit and its report download contain the
saved summary. These scans do not create persistent projects in the Endor dashboard.
