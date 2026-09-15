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
- Run the native ClawScan `endor` adapter in Docker. The normal ClawHub profile
  continues to use its existing execution configuration.
- Keep Endor separate from the ClawScan judge and the existing moderation verdict.
  Dependency vulnerabilities are supplemental findings; they do not independently
  quarantine a package or change its download policy.
- Display only findings tagged `FINDING_TAGS_REACHABLE_FUNCTION`. A reachable
  dependency or a potentially reachable function does not satisfy that filter.
- Store a bounded summary on the exact package release and the complete scanner
  report in file storage. Keep the total count when the displayed list is capped.
- An unsupported package is explicitly not analyzed. A scanner failure uses the
  existing job failure/retry path and must never become a successful empty report.
- Preserve the last stored result while replacement work is queued or running.
  Its check time identifies the analysis being displayed.
- Settle both concurrent scan processes before deleting their workspace.

The immutable uploaded artifact remains the source of truth. Endor's disposable
copy may normalize an npm shrinkwrap filename and remove unresolved workspace
development dependencies. Runtime dependencies remain unchanged; record those
normalizations with the raw scanner report.

## Hosted rollout

The worker is off for Endor until `CODEX_SECURITY_SCAN_ENDOR_ENABLED=1` is set.
Enable it only after the backend result contract is deployed and the following
worker configuration is available:

- `CODEX_SECURITY_SCAN_CLAWSCAN_VERSION`: an exact released ClawScan version that
  includes the `endor` adapter. The current default, `0.1.8`, predates that adapter.
- `CODEX_SECURITY_SCAN_ENDOR_IMAGE`: the Endor scanner Docker image pinned by its
  SHA-256 digest. Build it from ClawScan's `docker/clawscan-endor/Dockerfile` with
  the chosen Endor CLI binary.
- `ENDOR_NAMESPACE` and the `ENDOR_API_CREDENTIALS_KEY` /
  `ENDOR_API_CREDENTIALS_SECRET` secrets. `ENDOR_API` is optional.

The workflow checks that the adapter exists and pulls the pinned image before
claiming work. Credentials are available only to the worker step; the Endor
subprocess receives its own credentials, and the main scan does not inherit them.

This integration does not publish a ClawScan release, publish a Docker image, set
hosted secrets, or deploy ClawHub. Those are separate rollout actions.
