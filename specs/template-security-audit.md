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

## Qualification and rollout status

**Integration prepared; Template runtime activation is pending.**

Upstream Template contract reference: `ee3713d35a34a30374588a19d9a8f442019aa55e`
(`docs/template-audit.md`). This is not a qualified source/image runtime binding.

The current reviewed host source
`80d11a34a97a9181213c806fc3013123360f9012` does not contain this new Template
profile. ClawHub runs the installed host Go binary; its Docker command runner
executes AIG/Codex inside the immutable scanner image, not a second Go CLI.
The existing scanner image
`sha256:d494938b84a9f0da40504f611eec472d4637c755b5cef87b123daf8a2014545c`
may be reused unchanged if the new host source/binary/profile and that image are
qualified together. Its existing plugin qualification alone is not evidence of
Template-profile qualification.

The Template runtime registry is intentionally empty. Until a reviewed native
source commit and immutable image digest are qualified together and bound in
code, both workers retain their prior production routing. Returned
`clawhub-template` or AIG MCP output cannot activate or self-qualify that path.
No mutable environment switch, arbitrary install-source allowlist expansion,
host MCP fallback, or fabricated image digest is provided.

Rollout must bind the exact source, clean installed Go binary (including ignored
source-file checks), built-in profile/prompt, native image and no-fetch adapter
contract. Verify actual native whole-root execution and no dependency/audit
fetching before populating the binding; update the existing reviewed installer
and source-reporting support as required, without broadening arbitrary sources.
The shared runtime qualifier and artifact check preserve exact Docker binding.
The existing plugin-only sandbox override remains plugin-only.

Both consumers receive the expected profile from the trusted caller, defaulting
to `clawhub`. Template output requires explicit `clawhub-template` expectation,
exactly AIG MCP, the evidence-only judge and the qualified native runtime.
Ordinary skills/plugins keep their existing scanners and profile.

## Verification scope

Consumer regressions use explicitly synthetic source/image bindings and scanner
responses to test both workers, both family names, artifact layouts, strict
profiles/scanner sets, raw SARIF/provenance rejection, verdict semantics and
fail-closed rollout. They do not certify a shipped Template runtime or prove
Tencent's live no-fetch behavior. Native qualification remains a rollout gate.
