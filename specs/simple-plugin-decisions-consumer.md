# Simple plugin Decisions consumer preparation

Status: compatibility preparation only, not activation or scanner qualification.
The production scanner lock remains c3cfaf1515a47685786d72f031c714b1e5d9b34e.
No workflow, production environment, stored version or uploaded artifact is changed.

## Source contract

Inspected readonly openclaw/clawscan #148 at 000cda8 (Decisions schema and
optional overview; corrections were uncommitted) and #149 at d430dc4 (whole
plugin aig-mcp; dispatch, ranged reads and exhaustion corrections in progress).
Do not infer rollout permission from source/schema fixes or synthetic tests.

The future plugin lane is one AIG MCP scan over the complete uploaded artifact,
excluding node_modules at every depth. Embedded skills and dist/build output
remain in scope. No manifest decomposition or independent bundled-skill scans.
Standalone skill scanner selection is unchanged. The installed source capability
helper recognizes the paired pluginScanners override and Decisions command; the
old pin retains its existing targets and bundled-skill compatibility path.

## Consumer trust boundary

The typed verdict and confidence come only from judge.result. Model identity is
judge.result.decision.model, not the configured command or overview model.
Optional successful overview.result supplies summary, dimension details and
guidance. Missing/failed/malformed overview never changes the verdict or causes
invented summary text. Historical prose/receipt artifacts keep their old strict
validation, including v2 final-attempt provenance.

Decisions artifacts require native completed run/status, ordered times, actual
scanner command/exit/duration evidence, completed scanner without error, matching
judge attempt/result/start metadata and schema/prompt hashes. Requirements are
bound to the claimed target, never inferred from the scanner IDs returned.
A plugin cannot substitute skill evidence, or vice versa. Empty results and a
synthetic startedAt are not scanner execution proof. Exposure eligibility needs
a valid completed native run and at least one actual scanner execution; missing
metadata remains unknown rather than inventing judge calls or receipt retries.

## Explicit unqualified-runtime fence

The current #149 report cannot establish safe ranged-read/exhaustion behavior.
Both executable worker seams reject AIG MCP publication/rescan completion even
when the projection parses successfully. The installer explicitly refuses
unqualified aig-mcp installation. No stock package or unfixed upstream patch is
vendored as equivalent. Projection tests are synthetic wire-contract tests, not
provider/runtime qualification. This fence is intentional and must not be
removed merely to make a fixture publish.

Before activation a follow-up must inspect the merged corrected paired source,
install its reviewed patch and pinned dependencies, run its matching source
qualification (case-insensitive tool dispatch, root confinement, ranged reads,
iteration/provider exhaustion), verify genuine isolation, then remove the fence
with actual artifact and worker-seam evidence. Host-off execution is not enabled
by this preparation. The stdlib Decisions command is installed conditionally
from matching reviewed source/tests; the old pin without it remains supported.

## Routing / migration

See plugin-single-scan-routing.md. Preserve the exact prepublication analysis
snapshot for the version audit; Endor is report-only. Explicit admin rescan uses
the same validation path. No automatic scan, requeue or backfill should replace
the admitted plugin verdict. Existing immutable artifacts and historical scan
readability remain intact. No production data migration is run here.

## Validation limits

Targeted worker tests cover old receipts, each new verdict projection, missing
judge/verdict, failed scanners, unsuccessful/mixed-case SARIF invocations,
scanNote coverage failure, absent execution evidence, optional overview failure,
cross-kind substitution and the blocked current AIG MCP publication lane.
They do not validate the new profile live. Production activation requires a
separate explicit decision after upstream fixes, installer qualification and
real isolated end-to-end proof.

## Preparation validation record (2026-11-04)

- Full ci:types-build passed, including app/schema/CLI/admin typechecks and app
  build; separate Convex deploy TypeScript check passed. No remote push/deploy.
- Targeted consumer/receipt/worker/model-policy suites: 256 passed; final worker
  suite 85 passed, proving report-only dispatch launches no ClawScan. Backend
  recovery/public tests: 499 passed. Installer suites: 19 passed; conditional
  stdlib Decisions source qualification: 20 passed (not AIG MCP qualification).
- Full ci:unit attempted twice. Bounded rerun: 8859 passed, 37 failures in seven
  untouched transport/native files (local socket closures/provider fixture and
  native CLI timeouts). Changed-backend fixture regressions fixed and rerun.
- ci:static stops at repository bun fmt, unavailable in Bun 1.4.0 here. Installed
  oxfmt check, full type-aware lint and deadcode gates pass.
- ci:packages source tests pass without inherited OPENCLAW_CONFIG_PATH; built
  CLI artifact HTTP fixtures fail with socket closures. ci:e2e-http similarly
  reaches two CLI fixture failures. No unrelated transport recovery changes.
- Independent autoreview started GPT-6.1 Sol/high/Standard, P0-P3; authentication
  failed, no verdict produced. No supported command-auth fallback configured.
- Real local Convex/browser gate attempted via supported isolated runner;
  anonymous-agent backend failed startup on its three built-in attempts. No
  successful browser/runtime proof or screenshot. No UI files changed.

Later readonly inspection saw #148 at 66c4361 and #149 at 30524c5; #149 still had
uncommitted patch/test changes. Neither is paired merged source qualification or
authority to remove the worker/installer fence. Independent review, complete
install integration and UI absent-overview copy/proof remain follow-up blockers.

## Repair validation superseding the preparation record (2026-11-04)

Current main 612ab448 is merged. Its post-acceptance Plugin Inspector monitoring
remains intact; this branch does not reintroduce an in-publish Inspector action.

The three failed CI browser leaves were introduced fixture-contract mismatches:
shared completeMockPrePublicationChecks omitted analysis for clean outcomes on
both main and candidate. The stricter candidate correctly rejected bare clean
checks. Fixtures now provide canonical completed benign analysis, including the
newly merged Inspector authority-chain unit proof. No production gate relaxation.

The local backend startup and local transport failures were separately traced
to inherited HTTP_PROXY/HTTPS_PROXY routing loopback requests through a proxy.
Adding loopback-only NO_PROXY/no_proxy restored the supported isolated backend,
without changing external proxy routing or production env. Exact template,
old-CLI and Inspector CI leaf specs now pass locally: 9/9 real-browser tests.

Absent-overview copy now distinguishes a completed verdict with unavailable
optional prose from a scan that never ran or failed. Released CLI 0.14.0 uploads
a real local artifact; the supported prepublication action supplies simulated
scanner results without summary. The actual stored public version API is
asserted before real Chromium desktop/mobile audit captures. Both show Pass,
version 1.0.0 and truthful absent-overview text. Screenshots were inspected and
attached directly to PR #4411 comment 6626929490. This proves product/backend
consumer behavior, not live Decisions/AIG MCP or isolation qualification.

Independent narrative read-only review (GPT-6.1 Sol) found three P2s. The
Endor-only path now preserves its mounted workspace on unconfirmed container
cleanup and stops the worker; regression exercises both job modes. Retired
automatic jobs no longer starve expired recovery or create endless empty worker
dispatches. See plugin-scan-queue-retirement.md for bounded cleanup/pagination
and failed-recovery cursor semantics; historical rows/reports are retained.
Nine real Convex scheduler/index/pagination regressions fail against a6219be800
and pass the repaired candidate. Independent fix verification is pending.

Latest broad validation:

- ci:unit: 8899 passed, 5 skipped, coverage gate passed.
- ci:types-build, Convex deploy TypeScript, ci:packages and ci:e2e-http passed.
- Complete installed oxfmt check (1908 files), full type-aware lint, deadcode
  and release-action-pin checks passed. ci:static itself still stops at bun fmt,
  unavailable in local Bun 1.4.0; main has the same command. Hosted static passed
  on a6219be800, before the final queue repairs.
- A621 hosted code checks passed; only Vercel quota remained failed. No quota
  work, production deploy or activation was attempted. Later heads need checks.

Source qualification/install integration of the paired corrected upstream and
removal of MCP fences still require parent clearance and real qualification.
The production scanner pin and activation settings remain unchanged.

## Landed-pair qualification supersedes temporary fence (2026-11-04)

The parent cleared consumer preparation against landed source 56d17aaa and its
native both-architecture immutable runtime. See plugin-qualified-runtime.md for
exact source/tree/digest, qualification evidence, preparation commands, worker
source/binary/image checks, tests and remaining limits. The temporary blanket
MCP installer/completion fence is replaced by that exact image-only route.
Default production source pin, workflows and activation remain unchanged.
This is not complete live-provider/corpus validation or rollout permission.
