# Template-only native security audit

## Contract

A Template is selected only by the backend-claimed package release family:
legacy physical `claw` and public `template`. Artifact text, returned profiles,
publisher names, and existing reports cannot choose the security lane. The
canonical marker is `package.json` `openclaw.template`, a safe relative path whose
basename is `CLAW.md` (possibly nested); it does not narrow the scan root.
When the caller expects `clawhub-template`, consumers must also require native
`target.kind === "template"`. The profile name alone cannot prove that native
target detection selected the Template-aware AIG prompt. A missing, malformed,
skill, plugin, or unknown target is an operational rejection, even if its AIG
report and judge otherwise pass. This adds no target restriction to `clawhub`.

The approved native built-in profile is `clawhub-template`, with exactly one
scanner, `aig-mcp`. Scan the entire immutable locally extracted shipped Template
artifact, not only the marker, an embedded skill, or a manifest-selected subtree.
Preserve legacy ZIP and packaged artifact layouts. The Template-aware AIG prompt
must assess bundled content without fetching/installing external dependencies or
fetching their audit reports. ClawHub must not prepare/import bundled SkillSpector
results or invoke ancillary dependency-report scans for this lane.

The existing evidence-only Codex judge (`evidence-judge.md` /
`evidence-judge.schema.json`) only maps AIG SARIF evidence to the existing
benign/suspicious/malicious publication verdict. It is not a second artifact
review. SARIF severity is not a malicious verdict. Preserve judge/schema/hash,
execution/attempt accounting and raw evidence validation. Decisions or an
artifact-reading judge cannot substitute for the Template evidence judge.

AIG MCP must have a successful completed native `aig-mcp-scan` command (never an
imported `scanner-result`), one SARIF 2.1.0 run with that driver and
`properties.scanNote=complete`. If invocations are supplied, every one must report
successful execution. Missing, incomplete, malformed, failed or unqualified
execution is an operational failure, never an invented malicious verdict.
Suspicious findings retain the existing publication behavior; malicious blocks.
Secret scanning, claim/lease/fingerprint checks and Docker cleanup remain gates.

## Qualified host producer and scanner tools

Both workers bind Template dispatch to merged ClawScan source
`56bf1d9e3bd5247a0622acef8699dc69a10f2938` ([ClawScan #155](https://github.com/openclaw/clawscan/pull/155)),
source tree `92d8daba5c181560b4a73e71557b8d54e67e62b9`.
Its ordinary skill/plugin profiles are unchanged. The native scanner-tools tree
`ddfec1285eaf19beb3043e9e5ad043a0d274cb53` is identical to the previously
qualified image
`ghcr.io/openclaw/clawscan-runtime@sha256:d494938b84a9f0da40504f611eec472d4637c755b5cef87b123daf8a2014545c`.

ClawHub runs the installed **host Go binary**, which embeds/selects the built-in
Template profile and dispatches AIG/Codex commands inside the scanner-tools
image. There is no ClawScan CLI reentry inside that image. A host-only profile
change does not require rebuilding an unchanged tools image, but both the exact
host source tree and tools tree must match the reviewed binding. The installer
accepts only its fixed reviewed source selection, verifies both trees and source
cleanliness (including ignored files), and prepares the immutable MCP image with
its existing CLI/digest checks. No arbitrary source override is added.

Each Template claim verifies the installed binary's Go VCS revision and clean
source against that binding before execution. Prepublication source reporting
identifies that same host producer, not the image's original build commit.
The generic host-scanner `SANDBOX=off` setting remains available to ordinary
skills; Template scans always supply the pinned Docker sandbox and have no host
fallback or new environment activation knob. The existing plugin-only sandbox
override remains plugin-only. Unexpected source/binary/image settings fail
closed rather than falling back to ordinary Template scanning.

Both consumers receive the expected profile from the trusted caller, defaulting
to `clawhub`. Template output requires explicit `clawhub-template` expectation,
native `target.kind === "template"`, exactly AIG MCP, the evidence-only judge
and the qualified native runtime. Returned profiles, package text and scanner
reports never select or self-qualify a runtime. Ordinary skills/plugins keep
their existing scanners and profile.

Physical `claw` and public `template` publication claims retain the same 70-minute
lease as other native package scans, covering the 65-minute publication/drain
budget rather than expiring at the old 30-minute skill-style boundary. Skill
leases remain unchanged.

## Verification and release scope

Consumer regressions use explicitly synthetic scanner responses to test both
workers, both family names, artifact layouts, strict target/profile/scanner
sets, raw SARIF/provenance rejection and verdict semantics. They are not live
model-quality evidence. A CLI help check or image digest alone is not a complete
Template audit. Native qualification must exercise the exact host producer and
approved tools image, preserve the original artifact bytes, and confirm cleanup.

Deployment remains manual. The existing exact-SHA Test deployment and
`test-template-canary-prepublication.yml` provide a supported real pipeline
qualification route: one pending Test `@openclaw/hosted-e2e-canary` attempt,
matching Test backend build SHA, standard worker, and finalized clean secret and
ClawScan checks. The canary prepares the same pinned MCP image as the standard
workers and reserves their native scan/drain envelope. It does not weaken the
mandatory Docker guard or expand into arbitrary production fixtures.

### Fixed nonpublishing mechanical qualification

The same workflow also accepts explicit `mode=qualification` with no
`attempt_id`. This is a live native mechanical check, not a mocked verdict,
model-accuracy benchmark, registry publication/finalization proof, or substitute
for the exact-SHA Deploy Test integration gate. The default `mode=publication`
still requires one existing exact pending canary attempt and proves finalization.
No attempt is created, inferred, or selected as a fallback.

Both modes require main, the fixed Test deployment `academic-chihuahua-392`,
`CLAWHUB_ENV=test`, and its deployed backend SHA equal to `GITHUB_SHA`. The
qualification step receives only existing model API credentials, never the
Convex deploy key or worker token. Target verification uses the Test deploy key
in its separate read-only step. There are no new permissions, tokens, arbitrary
source/command/path inputs, registry/database/upload/queue/moderation writes,
existing-content rescans, or dependency/audit fetching in the qualification path.
Normal setup still installs the pinned scanner tooling.

`scripts/security/qualify-test-template.ts` copies only the checked-in inert
`fixtures/template-qualification` files into its own temporary artifact. The
small fixture includes CLAW.md, bootstrap instructions, disabled automation,
workspace notes and an embedded skill/plugin; none is executed or installed.
Its CLAW.md follows the current unified manifest (schemaVersion, agent, workspace
and disabled automations); tests validate the copied artifact through the real
package contract so manifest evolution cannot silently invalidate the fixture.
It uses the existing qualified source/binary verifier, native TruffleHog and
`runNativeClawScan` with mandatory pinned Docker and its existing cleanup.
It reserves the normal 65-minute drain budget inside the 75-minute step and
absolute hosted deadline. No database claim or lease is acquired. Raw reports
remain in that owned workspace, which is removed on success and ordinary failure.
If Docker cleanup/finality is unconfirmed, preserve its mounts under the existing
worker custody contract, fail with `docker_cleanup` and `workspaceRemoved=false`,
and leave teardown to the failed ephemeral runner. Never claim cleanup succeeded.

Workspace removal first uses unprivileged recursive removal. On Linux only,
EACCES/EPERM may invoke the fixed `cleanup-template-qualification.py` helper via
noninteractive sudo, after that same finality gate. The caller captures the
fresh mkdtemp root’s device/inode/owner before scanning. The helper requires that
identity, the caller’s non-root uid, the exact generated basename and private
0700 root; opens all ancestors/directories with O_NOFOLLOW; traverses by directory
fd on one device; and unlinks rather than follows symlinks. It is bounded to
10,000 entries, depth 64 and 10 seconds (15-second host process deadline).
It never chmods/chowns host paths, launches a container, or receives credentials.
No general cleanup input is added to the qualification command. Missing sudo,
identity mismatch, timeout or incomplete removal still fails qualification;
privileged exit alone is not success without a host-side absence check.
Ordinary publication/installed-scan workers are unchanged.

The failure in [run 42876751126](https://github.com/openclaw/clawhub/actions/runs/42876751126/job/130042013267)
was after completed benign evidence and did not record the filesystem errno or
path; those historical details remain unknown. The pinned native source
`56bf1d9e3bd5247a0622acef8699dc69a10f2938` proves the mechanism covered here:
`internal/runner/aig_mcp_scanner.go` creates scratch below the inherited TMPDIR,
executes AIG with that writable cwd and ignores deferred RemoveAll errors;
`internal/runner/sandbox.go` bind-mounts cwd writable without a user override;
the pinned runtime Dockerfile runs as root and documents AIG’s cwd `logs/` writes.
Root-owned nonempty directories cannot be recursively removed by the host uid.
Real root-owned 0755 logs and 0500 directory regressions reproduce EACCES and
verify deletion plus an unchanged external symlink sentinel. This proves the
repair’s filesystem behavior, not the exact missing error from that old runner.

Success requires unchanged fixture bytes, a clean secret gate, validated native
Template target/profile/image, completed AIG MCP command and complete SARIF, and
the existing evidence-only judge's validated terminal **benign** verdict. A
suspicious or malicious result remains a completed native verdict but fails this
known benign fixture check; it does not change normal publication policy. No
operational failure becomes clean, and no retry seeks a preferred verdict.

After Deploy Test succeeds for the exact new main SHA, an authorized operator runs:

```sh
gh workflow run test-template-canary-prepublication.yml \
  --repo openclaw/clawhub --ref main -f mode=qualification
```

The final log JSON uses `schemaVersion=clawhub-template-native-qualification-v1`:

- `mode=nonpublishing`; `status=passed|failed`; `failure` is null or a bounded
  stage enum (configuration, deadline, runtime, fixture, secrets, native_execution,
  native_evidence, unexpected_verdict, artifact_changed, cleanup, docker_cleanup).
- `workerRevision` identifies the checked-out main SHA. `source` and `image`
  give the reviewed pins above; `profile=clawhub-template` and
  `targetKind=template` declare the required lane, not success on their own.
- `sourceAndBinaryVerified`, `secretGate=clean`,
  `nativeEvidence=completed`, `verdict=benign`, `fixtureUnchanged` and
  `workspaceRemoved` must all pass. Completed evidence proves both AIG and
  judge validation; `not_validated` never means clean.
- `workspaceCleanup` adds bounded diagnostics: `method` is `not_run`,
  `unprivileged`, `scoped_privileged` or `preserved`; `initialError` and
  `finalError` are null or allowlisted error enums, never paths/messages.
  `helper_failed` covers unavailable/refused/invalid/timed-out helper execution;
  `identity` and `limit` identify helper safety refusals. A recovered permission
  error may coexist with success only when `finalError=null` and
  `workspaceRemoved=true`. Cleanup failure retains native verdict/hash evidence
  but sets `status=failed,failure=cleanup`; uncertain Docker custody remains
  `failure=docker_cleanup,method=preserved` without invoking either remover.
- `artifactSha256` hashes the validated raw native report;
  `fixtureSha256` hashes sorted relative file names and contents, NUL-separated.
  Absent evidence hashes/verdict are null. No raw report, error, prompt or secret
  is printed in the receipt.

Record the workflow URL, run SHA and receipt with the exact-SHA Deploy Test result.
Do not describe this mechanical proof as full-registry finalization or broad
scanner accuracy. Unit tests use explicitly synthetic responses and are not the
live qualification run. Production rollout remains a separate authorized action.

## Public audit UI identity

Template details link to the canonical publisher Template security-audit subpage,
with the displayed release pinned in the optional version query. Detail and audit
share scoped-first/unscoped-owner-matched lookup, reject other families/owners,
and never substitute a different release for an exact-version read. Anonymous
reads need no manage context. Missing packages/releases, no published release,
rate limiting and registry errors remain distinct. The audit route opts out of parent nesting so it neither renders nor loads the
latest detail view during historical navigation, reload or deep links.

The sidebar no longer repeats the Declared contents metadata block. Current
version, install readiness, manifest warnings and provenance-aware inventory
remain intact; artifact identity belongs on the audit detail.

Reuse the shared audit summary/page/findings. Only show stored Template scanner
reports, never a synthetic absent SkillSpector card or skill-only T01–T09 clean
checklist. Current Template scans use native AIG MCP plus an evidence-only judge;
legacy stored AIG/SkillSpector reports remain visible as recorded. The public
projection currently records scanner version but not driver/profile identity:
do not infer MCP from the Template family or version number. Show that limitation
rather than relabel historical evidence. Preserve raw rule IDs (including dynamic
and supplemental IDs), severity, location/range, message, remediation and stored
scanner provenance separately from the final judge verdict. Missing, pending or
failed evidence is not a clean scan. This read-only route grants no new rescan or
export permission.

Local browser evidence can use the guarded internal
`devTemplateAuditFixtures:seed` action. It creates an unscoped Music Manager
fixture under ameliomansour with a clean latest release and a historical release
with MCP/supplemental findings. Both scanner reports and judge verdicts are
explicitly simulated; the fixture is not live scanner-quality evidence. The
fixture refuses non-local dev-auth contexts and is not part of ordinary seeding.
