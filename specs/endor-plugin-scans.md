# Endor in the plugin scan pipeline

## Intent

Plugin publication and rescan requests enqueue work and return without waiting for
Endor's dependency and function-reachability analysis. Endor runs in the existing
ClawHub security worker, alongside the existing ClawScan profile. There is one
queue, one lease per release scan, and one completion submission.

New publications, owner-requested rescans, and admin bulk plugin rescans all use
this path. The existing dispatch watchdog and expired-lease recovery service the
queue. This change does not add a periodic full-catalog LLM rescan. Existing
plugins can be queued through the admin plugin bulk-rescan command, which already
supports paced batches and preserves active jobs.

## Result contract

- Apply Endor to package-release jobs. Skill scans keep their existing scanner set.
- Use ClawScan's custom command scanner to run the ClawHub-owned Endor wrapper
  in Docker. The normal ClawHub profile
  continues to use its existing execution configuration.
- Keep Endor separate from the ClawScan judge and the existing moderation verdict.
  Dependency vulnerabilities are supplemental findings; they do not independently
  quarantine a package or change its download policy.
- Display only findings tagged `FINDING_TAGS_REACHABLE_FUNCTION`. A reachable
  dependency or a potentially reachable function does not satisfy that filter.
- Store a bounded summary on the exact package release. Keep the total count
  when the displayed list is capped. Package jobs do not upload or retain full
  scanner reports; worker diagnostics remain bounded and redacted.
- An unsupported package is explicitly not analyzed. An Endor failure is saved
  as a failed analysis with a safe reason, never a successful empty report.
  The primary moderation result still completes and can quarantine the release.
  An Endor failure does not retry the whole job; owners or admins can request a
  rescan. Primary scanner failures retain the existing job failure/retry path.
- Preserve the last stored result while replacement work is queued or running.
  Its check time identifies the analysis being displayed.
- Settle both concurrent scan processes before deleting their workspace.

The immutable uploaded artifact remains the source of truth. Endor's disposable
copy may normalize an npm shrinkwrap filename and remove unresolved workspace
development dependencies. Runtime dependencies remain unchanged.

## Hosted rollout

The worker is off for Endor until `CODEX_SECURITY_SCAN_ENDOR_ENABLED=1` is set.
Enable it only after the backend result contract is deployed and the following
worker configuration is available:

- `CODEX_SECURITY_SCAN_CLAWSCAN_VERSION`: an exact released ClawScan version with
  custom command scanners and sandbox ownership/timeout cleanup. Endor needs no
  built-in adapter. The current default, `0.1.8`, predates the cleanup fixes.
- `CODEX_SECURITY_SCAN_ENDOR_IMAGE`: the Endor scanner Docker image pinned by its
  SHA-256 digest. Build it from `scripts/security/endor/Dockerfile`, with
  `scan.sh` and the chosen Endor CLI binary in the build context.
- `ENDOR_NAMESPACE` and the `ENDOR_API_CREDENTIALS_KEY` /
  `ENDOR_API_CREDENTIALS_SECRET` secrets. `ENDOR_API` is optional.

The workflow pulls the pinned image and checks its wrapper before claiming work.
The worker writes a trusted scanner profile outside the submitted artifact;
it contains credential names only. Credentials are available only to the worker step; the Endor
subprocess receives its own credentials, and the main scan does not inherit them.

The wrapper isolates npm/Yarn from scanner credentials, disables dependency
scripts and target-selected Yarn executables, rejects `.npmrc`, and scans a fresh
Git snapshot. It preserves findings JSON, converts successful empty output to an
empty report, accepts Endor's policy exit 128, and rejects analysis errors even
when Endor exits zero. The image retains the reviewed npm version that prevents
Git dependency prepare scripts from bypassing script suppression.

This integration does not publish a ClawScan release, publish a Docker image, set
hosted secrets, or deploy ClawHub. Those are separate rollout actions.

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
