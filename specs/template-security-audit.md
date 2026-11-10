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
