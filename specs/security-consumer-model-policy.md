# Security consumer model policy (2026-10-19)

## Intent and independent lanes

ClawHub's security consumers use three independent model lanes. A scanner's
`DEFAULT_MODEL` must never become the final verdict model or SkillSpector model.

- **Final ClawScan judge:** `gpt-6.1-sol`, high reasoning, explicitly
  configured with Codex `service_tier="default"` (Standard service).
  The reviewed bundled `clawhub` profile selects this judge; changing an AIG
  environment variable cannot change a hardcoded profile command.
- **A.I.G and SkillSpector:** each uses `gpt-6.1-sol`, medium reasoning and an
  explicit Standard (`service_tier=default`) request by default.
  AIG uses `DEFAULT_MODEL` / `REASONING_EFFORT`; SkillSpector uses
  `SKILLSPECTOR_MODEL` / `SKILLSPECTOR_REASONING_EFFORT`. Independent
  `AIG_SERVICE_TIER` / `SKILLSPECTOR_SERVICE_TIER` overrides accept only
  `default`, `flex`, `priority`, or `auto`; judge-tier settings never bleed into
  these scanner lanes. Explicit scanner settings
  survive the workers' restricted subprocess environments. Custom providers retain
  their own defaults instead of receiving an OpenAI model accidentally.
- **Endor-enabled judge:** the generated ClawHub profile uses `gpt-6.1-sol`, high
  reasoning, explicitly `service_tier=default`. This change does **not** enable Endor.
  Existing enablement, image-digest requirements and fail-closed behavior remain.

The local dry run sends Responses requests with the same final-judge default,
reasoning and Standard (`service_tier=default`, not `priority`) policy. Existing
`OPENAI_EVAL_MODEL`, `OPENAI_EVAL_REASONING_EFFORT` and
`OPENAI_EVAL_SERVICE_TIER` overrides remain supported for that evaluator and the
generated Endor judge. The ordinary production judge remains selected by the
reviewed ClawScan profile, not by those local evaluator environment variables.

## Source and transport boundary

The previously installed ClawScan npm 0.2.0 profile hardcoded GPT-5.5. Stock
SkillSpector and AIG installations also used older defaults and Chat Completions
paths. Environment-only changes cannot implement this policy: official GPT-6.1
Sol function/tool calls require Responses rather than Chat Completions.

`clawscan-source-commit.txt` pins merged ClawScan commit
`d4dc23c1525f2dd7d82e0b4ef087116daef6bbf0`. The
workflow installer fetches that exact commit, verifies HEAD, builds its Go CLI
with Go 1.27.3, and retains the matching source tree for host scanner installation.
No mutable `main`, `latest`, or unapproved public ClawScan release is consumed.

Keep the configured judge tier, wire-field presence and provider-returned tier
separate in acceptance evidence. Do not describe an omitted judge wire field as
an explicit API request. The direct Python scanners do send the explicit API
field. The workflows pin Codex CLI 0.164.0, including on runners with an ambient
CLI. The shared `setup-codex` action selects Node 24.22.1 for npm, installs the
reviewed CLI into a job-local prefix, verifies its exact version and publishes
that prefix through `GITHUB_PATH`. Another `codex` earlier on the runner's
original PATH cannot remain selected merely because it was already present.

The shared Bun action and standalone workflow selectors use stock Bun 1.4.4.
This does not select or replace OpenClaw's separately maintained Bun fork.

The host scanners consume **the same** source pins, Responses patches and offline
real-adapter tests as that ClawScan revision's runtime image:

- SkillSpector: NVIDIA source commit
  `95a52d89fa16f608f0b18ccee76b0918ea4b7eef`, with the maintained LangChain
  Responses path and its upstream `uv.lock` (`uv sync --locked --no-dev`).
- AIG: Tencent AI-Infra-Guard source commit
  `a5c5a72c2e5b88fc6e5b27e0c86110943c4d350b` (`skill-scan` package), with the
  ClawScan-owned Responses streaming adapter. The existing hash-locked AIG 0.2.2
  runtime dependency set is installed first; only the AIG package is replaced
  from patched source with `--no-deps`. In particular, its OpenAI SDK stays 2.8.1.
- The source pins are read from the reviewed ClawScan Dockerfile and checked as
  full commit IDs, so host/image implementations cannot silently drift. Patch
  applicability and the real installed adapter tests are mandatory install gates.
- The maintained resolver is pinned to uv 0.13.5. Pytest 9.0.2 is test-only. Source
  revisions and runtime dependencies are pinned; Python isolated-build backend
  dependencies are not claimed to be fully hash-reproducible. The AIG hash lock
  additionally admits the published macOS arm64 CPython 3.12 wheels for `jiter`
  and `pydantic-core`, without replacing the existing Ubuntu runner hashes. Its
  certifi dependency is 2026.10.23 with the normal published wheel hash. This
  independent update does not rewrite SkillSpector's upstream frozen CA lock.

The adapter implementation stays upstream in ClawScan; ClawHub must not grow a
second independent OpenAI adapter. Offline transport contracts prove serialization,
function round trips where applicable, and fail-closed stream/error handling. They
do not establish live model verdict quality or justify changing moderation policy.

## Honest judge provenance

Stored `llmAnalysis.model` / `clawscanAnalysis.model` is the **configured judge
identity** from execution metadata (`judge.configuredModel`, or a supported
literal `--model` in `judge.command`). It is not provider-returned identity.
Model-authored `judge.result.model` is untrusted evidence and is never promoted
into provenance. Legacy artifacts without execution metadata remain unknown;
never relabel their history using today's default.

The local Responses evaluator records the requested identity in `model` and,
when actually returned by the provider, keeps that separate as `providerModel`.
Its supplied environment controls the evaluator; it must not accidentally read
ambient process model settings instead.

## Operator exposure, not verdict evidence

Worker health keeps raw claimed/completed/failed counts separate from scan
execution, eligible scan attempts and native judge-command invocations. Eligibility
is evidenced by a completed or failed built-in static scanner in a final ClawHub
artifact; a missing artifact or unproven input rejection remains unknown. It is
not inferred from CLI exit 0 or a workflow conclusion.
Preparation and download failures before a new scan also leave eligibility unknown,
even when the control flow proves that no judge was invoked. They must not be
silently excluded as publisher-caused rejections.

Bundled SkillSpector command failures count as scanner-stage failures even before
ClawScan starts. Retain their timeout, exit and process-termination metadata without
command output, artifact contents or paths. A shared-budget deadline has no stale
termination receipt from a previous bundled root. Exit 1 with accepted findings
remains a successful scanner result. This accounting does not change retry policy,
judge exposure or Endor cleanup.

The bounded native `judge.attempts` records supply invocation and operational-failure
counts, including the first failed receipt even when the second attempt succeeds.
Only a failed receipt followed by a completed fresh-challenge attempt is counted
as recovered. Missing, malformed, inconsistent or pre-command-start retry metadata
leaves judge exposure unknown; legacy top-level status is not an invocation count.
These are native command attempts, not provider HTTP request/tool-call counts.
Known aggregate counts are partial whenever unknown runs remain.

Metadata validation is independent of scanner, receipt and verdict validation.
It cannot accept or reject a security verdict. A completed malicious verdict or a
correct secret block is not a clean scan. Newly reported exposure fields contain
only bounded execution state, boolean/null eligibility and numeric/null counts;
never result contents, inspection paths/challenges or error bodies.

Shared/priority workers retain opt-in phase stderr in existing redacted diagnostics.
Prepublication emits aggregate operator exposure without opting into progress
stderr, and strips prefixed progress records from public check summaries. Its
exact-artifact reuse, secret-check short circuits and finalization-only retries
record no **new** scan or judge invocation, not zero historical exposure. Dedicated
prepublication progress retention remains pending. No exposure fields are added
to publication payloads or stored verdicts, and green workflows do not prove scan
health or service recovery.

## Regression gates

- True worker subprocess tests capture both scanner models and reasoning efforts
  with default and distinct explicit settings, and verify worker credentials and
  ambient endpoint overrides are not forwarded.
- The generated Endor judge is executed against a fake Codex executable, proving
  the actual argv, high/override effort, Standard tier and safe shell quoting.
- Workflow/installer contracts cover exact source fetches, patch application,
  hash-locked AIG dependencies, locked SkillSpector installation, adapter tests and
  all three security consumer workflows. Invalid/mutable commit pins fail closed.
- Final verdict mappings cover configured model retention and missing/untrusted
  provenance. Local dry-run HTTP assertions cover requested and returned models.
- Before rollout, run the matched, freshly installed scanners and real judge on
  two tiny synthetic text-only skills: a benign greeting and obvious credential
  exfiltration/prompt-injection instructions. Do not execute artifact code. Bound
  requests and elapsed time, retain only redacted transport metadata and verdicts,
  and distinguish configured judge identity from provider-returned scanner models.
  Require an explicit Standard-tier request, not merely an observed default tier.
  This is a wiring/sanity gate, not a statistical moderation-quality evaluation.

Any release/deployment, queue processing, Endor activation, public ClawScan
publication or replacement of these source pins needs separate authorization.

## Required upstream handoff gate

Before activating the workflow switch, the reviewed ClawScan source must serialize
actual judge execution metadata: an honestly derived `judge.configuredModel`.
The consumer also accepts a supported literal model from legacy `judge.command`,
but upstream deliberately omits the full command to avoid disclosing embedded
credentials. It must not infer the model from model-authored output or silently
stamp its current default onto an artifact. A real local worker -> ClawScan ->
fake-Codex check against the initial candidate found missing execution metadata,
even though Codex received Sol/high; the upstream follow-up adds runner-derived
configured-request provenance. This does not attest provider-returned identity.
The source lock now selects the reviewed merged revision containing that fix,
explicit Standard-tier configuration in both bundled Codex judges, explicit
`service_tier: "default"` requests in both scanner adapters, and provider-aware
scanner defaults. Fresh installation and real-provider
acceptance must use that exact lock, not an earlier provisional binary.
