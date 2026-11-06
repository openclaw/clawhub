# Qualified image-only plugin consumer runtime

Preparation binding, not a production pin, activation switch, deployment, data
migration or model/corpus approval. Default installers/workflows still consume
`clawscan-source-commit.txt` at c3cfaf1515a47685786d72f031c714b1e5d9b34e.

## Reviewed native binding

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

## Explicit preparation commands

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

## Both executable worker paths

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

## Preparation verification and limits

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

## Supervisor custody and target disambiguation repairs

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
work settles. Manual scan workers similarly stop, including when recording the
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

## Scoped rollout deadline integration (binding pending native successor)

The approved rollout adopts the whole source: the shared judge becomes Decisions
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

## Scanner-report-only Codex successor preparation (2026-11-06)

The subsequently approved direction replaces the Decisions judge with the native
EvidenceOnly Codex profile. Consumer projection accepts its exact typed verdict,
confidence, five dimensions and contextual findings without requiring decision.api,
inventing Decisions probabilities, or asking for an independent artifact-inspection
receipt. Built-in profile, terminal complete state, scanner execution provenance,
matched final judge attempts, valid verdict/schema and immutable plugin sandbox
checks remain required. Optional overview prose cannot change the verdict.

This local compatibility work does not qualify or activate an image. The final
reviewed source/tree/runtime-tree/digest binding, default pin and installer CLI
qualification must be changed together when the producer provides its receipt.
The old source56 Decisions image is not the approved deployment target. Historical
receipt/Decisions readers remain for retained evidence; they are not new rollout
selection. Plugin scans stay AIG MCP only; skills stay SkillSpector plus AIG with
their existing specific timeout/sandbox settings. The shared judge changes.
EvidenceOnly restricts source exposure, but residual delegation capabilities are
not claimed absent merely because the five approved runs exposed no visible artifact/tool activity; their JSON events do not establish absence of delegation.
