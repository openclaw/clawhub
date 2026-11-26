# ClawScan 0.4.0 qualified consumer runtime

Status: the fixed Template passed native consumer qualification on Test with the
ClawScan 0.4.0 source and immutable runtime. Production promotion remains separate.
This proof does not authorize production rollout, historical rewrite, bulk requeue
or data migration.

## Qualified binding

- Merged ClawScan source: 9bc83753a6f1af7ff077917262190ada0152891b ([PR #223](https://github.com/openclaw/clawscan/pull/223)).
- Source tree: c08631fa26a49ac711b828a4ead389ded92b2fa5.
- Runtime tree: 9f1aa0ad7bba119153550651bb74c1ab4576808a.
- Immutable image: ghcr.io/openclaw/clawscan-runtime@sha256:c7723e88a47f4ff61530a7f3140b0c72f51293ab8514435c7c3aeb518a8000b1.
- Native amd64/arm64 publication and installed CLI qualification:
  https://github.com/openclaw/clawscan/actions/runs/45565644265.

This is the verified v0.4.0 tag image for the exact release source. Its retained
manifest and independent registry readback bind both native platforms and their
provenance to that source. Filesystem layers differ from the earlier main build;
the tag image passed its own consumer runtime checks below.

Plugins run one whole-artifact AIG MCP audit in that immutable Docker image.
Skills use SkillSpector plus AIG; the shared judge reads scanner reports only.
Templates retain canonical claw-family requirements and native rescans. New
EvidenceOnly results do not require Decisions metadata or an artifact-inspection
receipt. Complete native execution, exact attempts, valid verdict/schema and
source/image binding remain fail-closed. Historical readers remain supported.

## Executable installation / qualification

Use a disposable isolated runner with RUNNER_TEMP, GITHUB_ENV and GITHUB_PATH
set as in Actions. Both optional-source and default installation now select the
same qualified source:

```sh
sh scripts/security/install-clawscan.sh 9bc83753a6f1af7ff077917262190ada0152891b
# Apply CLAWSCAN_SOURCE_DIR and PATH emitted through the Actions files before
# invoking the scanner installer; keep that retained source checkout clean.
sh scripts/security/install-clawscan-scanners.sh aig-mcp \
  9bc83753a6f1af7ff077917262190ada0152891b

docker run --rm --pull never --network none --entrypoint /bin/sh \
  ghcr.io/openclaw/clawscan-runtime@sha256:c7723e88a47f4ff61530a7f3140b0c72f51293ab8514435c7c3aeb518a8000b1 \
  -ec 'aig-mcp-scan --help >/dev/null; codex --help >/dev/null'
```

Installers verify exact source/tree/runtime tree and clean tracked/untracked/
ignored state. Workers additionally verify embedded VCS revision, unmodified
binary/source identity and immutable image. No mutable image or host MCP fallback.
Historical stdlib Decisions compatibility tests still run; their command is not
the active EvidenceOnly judge. Caller-owned Docker endpoint/context/config/TLS
settings survive both restricted worker environments and cleanup; scanner/provider
credentials do not reach cleanup.

## Verified publisher context

Both package native invocations write a private context JSON containing only
trustedOpenClawPlugin, true strictly when the backend-derived target boolean is
true. They pass its path using --context. Backend persisted publisher ownership,
including existing requireSecurityChecks suppression, remains the authority;
artifact names/scopes/text cannot confer trust. No package contents, signed URLs,
lease tokens, old reports or Endor evidence enter this caller context. Skills
retain their existing context behavior. The producer inserts that explicit caller
context into its evidence-only prompt, rather than reading outer metadata.json.

## Qualification evidence and limits

Both native image builds and the complete manifest publication passed for the
release. Independent registry readback verified the immutable index bytes,
both platform manifests/configs and the exact source revision. The retained
manifest artifact agrees with that readback and both native smoke proofs.

The real installer passed against the same host source and earlier main-build
image `sha256:5036a4a3d62175f85092c20736cba96c89ecc45b9ddf74e8ba7a0462d8b396ed`
on an isolated Ubuntu 24.04 amd64 Testbox with Python
3.12.16 and Go 1.27.3: 24 historical judge tests, 212 SkillSpector tests and 259
AIG adapter tests. The immutable image passed its network-disabled MCP CLI and
Codex version checks. Both worker lanes accepted the real clean source and its
VCS-bound host binary for plugin and Template dispatch. Testbox workflow:
https://github.com/openclaw/clawhub/actions/runs/45563945160.

An initial relocated Python setup loaded the host's older shared library in
clean subprocesses; the failed AIG checks passed after installing the same
verified Python distribution at its standard Actions prefix. No source or test
expectation changed for that runner repair.

These installer and admission checks made no provider calls. The separate native
Template qualification below provides the provider-backed consumer proof.

The final tag image was separately pulled by immutable digest on a fresh Ubuntu
24.04 amd64 Testbox. Its source/version labels, MCP CLI, AIG MCP 0.2.0 and Codex
0.164.0 passed with container networking disabled. The root image reports
SkillSpector 2.12.0 and OpenAI SDK 2.54.0; those image packages do not replace the
separately locked host scanner environments. Testbox workflow:
https://github.com/openclaw/clawhub/actions/runs/45566877707.

### Native Template qualification

The fixed, nonpublishing Template passed on protected `next` at
`5c3f4d023e61c353108fd55baa7618c72cf2cd6f` on November 26, 2026:
https://github.com/openclaw/clawhub/actions/runs/45797945124.
The workflow verified that Test served this exact revision after successful
[CI](https://github.com/openclaw/clawhub/actions/runs/45796634441) and
[Deploy Test](https://github.com/openclaw/clawhub/actions/runs/45796634335) runs.
The publication step was skipped. The native scanners and judge used real provider
calls with the source, image, profile and fixture selected by the workflow.

The bounded receipt records:

- `schemaVersion=clawhub-template-native-qualification-v1`,
  `mode=nonpublishing`, `status=passed` and `failure=null`.
- `workerRevision=5c3f4d023e61c353108fd55baa7618c72cf2cd6f`, with the
  source and immutable image in the qualified binding above.
- `profile=clawhub-template`, `targetKind=template`,
  `sourceAndBinaryVerified=true`, `secretGate=clean`,
  `nativeEvidence=completed` and `verdict=benign`.
- `fixtureSha256=dbddf643c90ef169d2518f46709092206d3ff95c08bd6357c29392e92d8ab012`,
  equal to the independently hashed committed fixture, and `fixtureUnchanged=true`.
- `artifactSha256=896a2fbe1ca70b477526542889d748209dcbcb6cd5af70f16a3fcf23fac85f64`.
- `workspaceRemoved=true`. Cleanup used `method=scoped_privileged` after
  `initialError=EACCES`, with `finalError=null`.

The reviewed main candidate at `03271bd6f0c9c307cb8e0e131bdb85699053757b`
matches all 208 selected scanner, schema, fixture, setup and runtime-closure files
in the qualified Test revision. Their aggregate SHA256 is
`29d91bf5eec53a77f62c2f8897eecb5bc24398e7bb40ca4f24aeb453fd13ea2f`.
The selection excludes only `scripts/security/package-publish-workflow.test.ts`
and `scripts/security/skill-publish-workflow.test.ts`, which the qualification does
not execute. It includes scanner installers, locks, fixtures and all schema inputs.
The aggregate hashes sorted rows of relative path, NUL, file SHA256 and newline.

Main alone includes the UI font `@fontsource-variable/instrument-sans@5.3.0`.
After removing exactly that manifest declaration, root lock declaration and
dependency-free lock node, the complete manifest and all 1,045 remaining lock nodes
match. The font has no reference in the qualified input set. Canonically sorted
JSON hashes are `0fa13d18b734e512dec496c561b806488aac603783a68d52ec1dbdb1bcc317cb`
for the manifest and `16dd3a7e1b443d0ed1912699200bf9c1b1cb6f5e3698a9e177177610e2d9de17`
for the lock. Independent review verified this bounded difference.

This proof covers one fixed Template and the native consumer contract. It does not
establish corpus accuracy, full-registry publication or production execution.
The [Test integration](https://github.com/openclaw/clawhub/pull/4970) preserved
the existing Connections commits on `next`. No production deployment occurred.

### Historical provider qualification

The following evidence belongs to the earlier producer
80d11a34a97a9181213c806fc3013123360f9012 and image
d494938b84a9f0da40504f611eec472d4637c755b5cef87b123daf8a2014545c.

Actual clean merged-source installer and 24 isolated compatibility tests passed.
Real exact-image inert skill and plugin runs completed their native scanners,
Codex judge and optional overview; strict ClawHub projection accepted both. These
were real provider/container calls, not substituted scanner output. Scoped Colima
connection left protected containers unchanged and removed qualification containers.
Do not generalize that proof to corpus accuracy, all tool-capability absence, or
production execution. The local native Convex authority fixture separately proves
allowed Endor-only writes and rejection of stale/retired/substituted authority;
only its Endor subprocess transport is simulated. Production was untouched.

## Scan workspace cleanup

Deleting a Codex scan workspace must never change the job's result or error.
When the workspace is not preserved for container custody, the worker deletes
it on a best-effort basis. Docker sandboxes leave root-owned files in the bind
mount, so the delete can fail (EACCES on Linux). On Linux, Bun 1.4.4 leaves
only the undeletable subtree. On macOS it can stop early and leave more,
including the extracted artifact.
The worker logs `security_scan_workspace_cleanup_failed` with the errno code and
keeps going. Leftover workspaces can pile up until the runner is torn down. That
is accepted on hosted runners, which are discarded after each run. Local runs
(`CLAWHUB_ALLOW_LOCAL_CODEX_SCAN=1`) leave them in the temp dir. Removing them
for real would need the scoped privileged helper used by
`template-qualification-workspace.ts`.

## Historical preparation record (superseded)

The following source56/c3 records describe earlier preparation, not current
installation commands, accepted pins, activation status or rollout authorization.

### Historical: Earlier source56 preparation

Preparation binding, not a production pin, activation switch, deployment, data
migration or model/corpus approval. Default installers/workflows still consume
`clawscan-source-commit.txt` at c3cfaf1515a47685786d72f031c714b1e5d9b34e.

### Historical: Reviewed native binding

- ClawScan landed source: 56d17aaa423cdb1ed87aeda970b9a2b30eed7dd8
- Source tree: d860e0022e5832b76abf7c7ab6c3a679fdda1f64
- Runtime tree: ddfec1285eaf19beb3043e9e5ad043a0d274cb53
- Immutable image: ghcr.io/openclaw/clawscan-runtime@sha256:9c765a089a034451c428d563f0f09f4004c898ac14802470bb6a58fca7755960
- Native amd64 + arm64 + manifest publication: openclaw/clawscan run 41816825573,
  https://github.com/openclaw/clawscan/actions/runs/41816825573

The exact native image build applies the reviewed MCP patch and passes 28
static-tool/entry-network tests, including mixed-case no-execution dispatch,
root confinement, symlink/path rejection and model-visible ranged reads. The
matching stdlib Decisions tests pass 24 cases. The adapter source separately
rejects provider/iteration exhaustion and incomplete SARIF; ClawHub does not
infer completion from an empty results list. These facts replace the temporary
blanket MCP installer/completion fences. They do not authorize rollout.

### Historical: Explicit preparation commands

Run only in an isolated runner; these are not changes to production workflows:

```sh
sh scripts/security/install-clawscan.sh 56d17aaa423cdb1ed87aeda970b9a2b30eed7dd8
# Use CLAWSCAN_SOURCE_DIR returned by the installer; it must stay clean.
sh scripts/security/install-clawscan-scanners.sh aig-mcp \
  56d17aaa423cdb1ed87aeda970b9a2b30eed7dd8
```

The optional argument accepts only the unchanged default or the qualified
candidate. Candidate source, source tree, runtime tree and tracked/untracked/
ignored cleanliness are checked. The matching isolated stdlib test command is
run before exposing clawscan-decisions-judge on PATH. MCP preparation pulls only
the immutable image, verifies its RepoDigests entry and runs:

```sh
docker run --rm --pull never --network none --entrypoint /bin/sh \
  ghcr.io/openclaw/clawscan-runtime@sha256:9c765a089a034451c428d563f0f09f4004c898ac14802470bb6a58fca7755960 \
  -ec 'aig-mcp-scan --help >/dev/null; clawscan-decisions-judge --help >/dev/null'
```

No host MCP executable, stock package fallback, provider SDK or host-off opt-in
is installed. No activation variables are emitted. Existing old-pin scanner
installation stays intact.

### Historical: Both executable worker paths

Only code-plugin/bundle-plugin releases use the plugin override. Skills and
Templates do not inherit it. Before starting MCP, both publication and manual
rescan paths reuse the installed Git/Go source verifier: exact source, clean
tracked/untracked/ignored checkout, same executable path, embedded VCS revision
and vcs.modified=false. They force Docker with the qualified immutable image.
Host-off or alternate/mutable image settings fail before execution. Returned
artifacts must attest the same sandbox/image; Decisions results require the
built-in profile, matching completed native attempts and real scanner command/
exit/timing evidence. Imported scanner-result reports do not count as execution.

AIG MCP 0.2.0 SARIF does not emit invocations. Absence is compatible; if supplied,
invocations must be successful and cannot contain conflicting mixed-case failure
aliases. Native scanner completion/provenance and the qualified adapter/image,
not synthetic invocations or prose, establish the scan boundary. Optional
overview failure still leaves an otherwise valid verdict intact.

### Historical: Preparation verification and limits

Actual source installations were run locally for both default c3cfaf15 and
candidate 56d17aaa. Both embedded VCS revisions were clean; candidate stdlib
judge tests passed 24/24, command resolved on installer PATH, and the worker
source/binary verifier plus optional source-reporting path accepted that exact
installation. Readonly landed-source AIG MCP adapter tests passed 22 top-level
tests, including provider/exhaustion/incomplete-report handling.

Local Docker is unavailable. Local installer Docker tests therefore use
executable mocks; actual patched image qualification is the native both-arch
CI evidence above, not an invented local image run. Worker seam tests use
synthetic provider artifacts with actual subprocess I/O; they prove every
verdict in publication/manual-rescan mapping, failure and isolation rejection,
not live provider behavior. Parent owns the existing 20+6 live-provider sample;
no duplicate corpus was started. Original browser proof is unchanged.

Full local unit coverage after integration: 8939 passed, 5 skipped. Types/build,
packages, full lint and full installed formatter passed. Independent narrative
read-only review of the integration found no actionable P0–P3 findings.
No helper-owned isolation or production readiness claim is conferred.

### Historical: Supervisor custody and target disambiguation repairs

An exact-head review after ac583161 identified two missing native contracts.
First, a root directory containing both SKILL.md and a plugin manifest is
ambiguous to the native resolver. Workers now retain their claimed-family
manifest selection; that selects plugin identity, not a sub-artifact or separate
skill scan. Native ClawScan still scans the full parent artifact. The exact
source56 binary reproduces the ambiguous directory rejection, while explicit
openclaw.plugin.json passes target resolution and reaches credential preflight.
No model call or duplicate corpus is needed for that regression.

Second, killing a local Docker CLI/process group does not establish daemon-side
container disappearance. Both qualified worker paths now use the existing
shared process supervisor plus a per-run cleanup helper following upstream
docs/sandbox.md. Each invocation receives a fresh CLAWSCAN_SANDBOX_RUN_ID; the
helper enumerates by that exact run label, independently verifies immutable
container ID/run label/random command label, removes every owned scanner/judge/
overview container by ID, verifies each disappearance and checks final residue.
Foreign/mismatched ownership is never deleted. Cleanup forwards only the Docker
destination environment, not scanner/provider credentials.

A zero-exit host is insufficient: native ClawScan can contain an optional
overview timeout. Before accepting normal completion, the supervisor also
requires completed native child-finality evidence. A started overview must be
completed without an error; absent or explicitly never-started overview is
safe. A failed/timed-out started overview, malformed evidence, failed/nonzero/
unknown host termination or missing proof uses the bounded cancellation sweep.
Empty polls cannot certify that unseen daemon creates were cancelled. After the
bounded window it fails closed, preserving the mounted workspace and stopping
further claims even if currently visible containers were removed. This custody
decision does not relabel a valid Decisions verdict or fabricate overview prose.
A failed optional overview that never started remains compatible with a valid
verdict.

Prepublication does not swallow this error as ordinary scan failure; it retains
workspace custody, emits workerMustStop, and stops after already-active batch
work settles. Before stopping it releases its exact check claim into the
five-minute retry backoff, without counting a scanner failure, and the backend
dispatches a targeted worker for the attempt, so custody of one host never holds
the attempt for the full lease. Retryable scanner failures likewise dispatch a
targeted retry after the backoff rather than waiting for the scheduled sweep. Manual scan workers similarly stop, including when recording the
backend failure itself is unavailable. Legacy/nonqualified command paths are
unchanged. Real process-supervisor tests and executable mocked-daemon tests
cover multiple/late containers, ownership mismatches, daemon/removal failures,
unknown finality and contained overview cancellation. There is no real local
Docker-daemon claim; native image qualification remains the upstream evidence.

Repair validation: four cleanup/worker seam suites passed 213 tests; full unit
coverage with serialized file execution passed 8993 tests, 5 skipped. Full
TypeScript/build, lint and installed formatter passed. A prior parallel run
had two unchanged test timing failures: the Skill Card immediate-claim class
reproduced on frozen ac583161 baseline, and the tight SkillSpector subprocess
budget passed in isolation. No unrelated Skill Card or capacity changes.

The qualified Docker runner deliberately omits positive commandStarted metadata:
starting a Docker client is not proof that its shell started. Completed validated
judge/attempt/overview output is accepted with that omitted flag; explicitly
false completed attempts and malformed supplied flags are rejected. A completed
overview without the flag retains its prose and is finality-safe. Failed or
timed-out overview with unknown start remains custody-unknown. Failed unknown-
start judge attempts retain null invocation/failure counts; no receipt recovery
is invented. Regressions use this actual native Docker JSON shape.

Final repair verification supersedes the earlier test count: serialized full
unit coverage passed 8995 tests, 5 skipped. Full types/build, lint and installed
formatter passed; final cleanup/Decisions predicate suites passed 81 tests.
Independent narrative read-only review of all repair source/tests and owning
loops found no actionable P0–P3 findings. No real-daemon/corpus/UI rerun or
production-readiness claim is implied by these compatibility/custody tests.

### Historical: Plugin deadline integration (current budgets; historical rationale)

The approved rollout adopts the whole source: the shared judge becomes scanner-only Codex
and skills no longer request clawscan-static. This is not a plugin-only model
change. Skill-specific subprocess settings and host sandbox selection remain
unchanged; only code/bundle plugins get the longer subprocess deadline.

Native source56 cannot accept --timeout and constructs the MCP runner with 20m.
The producer owns a narrowly qualified plugin-only 30m successor and immutable
image. Do not activate the intermediate workflow patch with the old default pin:
the final source/tree/image binding must be updated together after native proof.
No component resolver, historical data rewrite or bulk requeue is involved.

Consumer ceilings allow native MCP 30m + native judge 20m + optional overview 5m:
plugin subprocess 60m (including process/container cleanup headroom), publication
job drain 65m and claim lease 70m. Explicit rescans can first spend 20m in Endor;
their job drain is 85m and backend enforces a 90m lease. Skill leases and automatic
Endor-report-only job leases retain their previous normalization. Templates keep
the 30m staged claim lease. Historical package claims without family reserve the
conservative package budget; no old evidence is changed.

Workers retain their existing claim-window setting, but also require a complete
worst-case job drain window before claiming, including the first claim. Already
active work drains normally. Hosted jobs publish an absolute deadline before
setup, less a 2m tail reserve; slow installation reduces available admission.
The publication worker step is capped at 75m within a 100m hosted job; the manual
worker step is 100m within 125m. Step and hosted deadline minima both apply.
These limits do not guarantee arbitrary stalled storage/backend calls finish;
they prevent intentional scanner budgets from outliving their claim/workflow.

## Historical successor preparation (2026-11-06; binding now qualified above)

The subsequently approved direction replaces the Decisions judge with the native
EvidenceOnly Codex profile. Consumer projection accepts its exact typed verdict,
confidence, five dimensions and contextual findings without requiring decision.api,
inventing Decisions probabilities, or asking for an independent artifact-inspection
receipt. Built-in profile, terminal complete state, scanner execution provenance,
matched final judge attempts, valid verdict/schema and immutable plugin sandbox
checks remain required. Optional overview prose cannot change the verdict.

Typed SkillSpector consumers preserve the existing usable-partial contract from
#4171: successful structured `partial` evidence with `reportPolicy: judge-gaps`
and native exit 0 or 1 may reach a completed judge. Coverage gaps stay in the raw
report and diagnostics; they are uncertainty for the judge, not execution failure.
Missing/malformed/unsuccessful evidence, crashes, imported reports, missing native
execution metadata and incomplete judges still fail closed. This exception does
not relax AIG or the plugin-only AIG MCP contract. Both executable worker seams
cover benign/suspicious typed verdicts and the invalid-evidence boundaries.

This local compatibility work does not qualify or activate an image. The final
reviewed source/tree/runtime-tree/digest binding, default pin and installer CLI
qualification must be changed together when the producer provides its receipt.
The old source56 Decisions image is not the approved deployment target. Historical
receipt/Decisions readers remain for retained evidence; they are not new rollout
selection. Plugin scans stay AIG MCP only; skills stay SkillSpector plus AIG with
their existing specific timeout/sandbox settings. The shared judge changes.
EvidenceOnly restricts source exposure, but residual delegation capabilities are
not claimed absent merely because the five approved runs exposed no visible artifact/tool activity; their JSON events do not establish absence of delegation.
