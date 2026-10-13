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
Container-local loopback remains available, including Docker's local DNS resolver;
it cannot reach the host's loopback services. The disposable `/tmp` mount allows
execution of the owned npm/Yarn shims. The wrapper invokes each shim directly
before scanning and stops if the mount prevents execution.
The worker grants network-admin capabilities only so the container can install
those rules before scanning; image workflows verify the rules and privilege
drop on a Linux Docker runner.

Image publication, hosted configuration, and ClawHub deployment remain separate
manual rollout actions.

The same `Endor Scanner Image` workflow has a manual report-only trial: select one
frozen `trial-package` instead of `none`. It accepts Discord and Codex 2026.9.9
from the verified OpenClaw publisher, or community Google OAuth 0.4.0, and checks
the npm tarball identity and frozen SHA-256 before scanning. Only the official
packages receive the explicit first-party trust assertion. The Linux job builds
and checks its pinned Endor image, then runs the existing local plugin CLI with
ClawScan 0.2.0, Codex 0.142.3 and the worker's pinned SkillSpector revision.
It uses repository scanner credentials and the configured Endor namespace/API;
it needs no Test login, admin key, deployment environment or backend job. Any
valid judge verdict is acceptable, but Endor and the judge must both complete.
The Ubuntu trial loads the distribution's bubblewrap AppArmor profile, then
checks that Codex can read files while writes remain denied before authenticating.
Only bounded redacted reports and worker diagnostics pass the pinned secret
guard into a seven-day artifact. The trial cannot publish an image or submit
moderation changes. `none` preserves image publication from `main`.

Select `official-remaining` to scan the other 93 frozen official npm plugins with
at most four concurrent jobs. The 94-entry
`scripts/security/endor-official-plugins.json` records package versions and
checksums from the verified OpenClaw publisher catalog and downloaded releases.
Official tarballs come from ClawHub's versioned artifact download endpoint, matching the
frozen published artifact bytes; npmjs.org releases may contain different bytes.
The download route records ordinary download telemetry without counting a scan
as a plugin install. The trial submits no scan jobs or moderation results.
It includes BlueBubbles 2026.5.7 and OCF Fleet Acceptance 0.1.1; the other 92
releases are 2026.9.9. Manifest membership supplies the first-party trust
assertion. Community Google OAuth remains untrusted. Codex 2026.9.9 is excluded
from the batch because its full hosted scan already completed in
[run 38362196418](https://github.com/openclaw/clawhub/actions/runs/38362196418).
The three individual trials remain available.

Each matrix job validates its own tarball and uses the same scanner profile,
sandbox preflight, completion check, and bounded redacted artifact upload gate.
Its artifact name identifies the package and version. Findings are valid
completed outcomes; scanner or judge failures fail the job. A failed package
does not cancel other jobs or remove their reports. The batch remains manually
triggered and report-only, with no backend submission or deployment.

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

Local plugin batches reuse the same Endor runner, bundled-skill selection, ClawHub
profile, and judge-result validation. They consume release tarballs and save local
reports without claiming jobs or submitting moderation changes. First-party trust
is an explicit assertion by the caller, rather than inferred from a package name.
Endor uses public DNS resolvers because the container guard blocks private host
resolvers.
