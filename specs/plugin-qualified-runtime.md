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
