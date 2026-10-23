---
summary: "How to understand ClawHub security audit results before installing a skill or plugin."
read_when:
  - Understanding ClawHub security audit results
  - Deciding whether to install a skill or plugin
  - Explaining ClawHub audit status, risk level, or findings
title: "Security Audits"
sidebarTitle: "Security Audits"
---

# Security Audits

ClawHub security audits help you decide whether a skill or plugin is safe enough
to install. They show what a release does, what authority it asks for, and
whether anything deserves extra attention before it can access files, accounts,
credentials, code, or external services.

Audits are strong safety signals, but they are not a guarantee that a release is
risk-free. Always use judgment before granting sensitive access.

See also [Security](./security.md), [Acceptable usage](./acceptable-usage.md),
and [Moderation and Account Safety](./moderation.md).

## What to check before installing

Before installing, review:

- the overall audit status
- the risk level
- any listed findings
- required credentials, permissions, or environment variables
- owner, source, version, changelog, downloads, stars, and other trust signals

Install only content you understand and trust.

## Audit status

Audit status tells you how to react to the audit result:

| Status      | Meaning                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| `Pass`      | No visible issue above low risk was found.                                |
| `Review`    | Read the findings before installing. The release may still be legitimate. |
| `Warn`      | Use extra caution. ClawHub found a high-impact concern or warning signal. |
| `Malicious` | Do not install.                                                           |
| `Pending`   | Audits have not finished yet.                                             |
| `Error`     | The audit could not be completed.                                         |

A `Pass` is reassuring, but it does not replace your own judgment. This matters
most for tools that can publish content, edit data, run commands, read files, or
access production systems.

## Risk level

Risk level describes blast radius: how much power the release appears to have if
you use it as intended.

| Risk level | Meaning                                                                       |
| ---------- | ----------------------------------------------------------------------------- |
| `Low`      | Little sensitive authority or user impact was found.                          |
| `Medium`   | The release has meaningful authority, such as account access or data changes. |
| `High`     | The release has high-impact authority, severe findings, or malicious signals. |

Risk level and audit status answer different questions:

- Risk level asks: "How much power is here?"
- Audit status asks: "What should I do with this result?"

For example, a publishing skill may show `Review` with `Medium` risk. That does
not mean it is malicious. It means the skill appears purpose-aligned, but can
act with meaningful account authority.

## Findings

Findings explain why an audit result was shown. Each finding usually includes:

- what it means
- why it was flagged
- the relevant skill or plugin content
- a recommendation

Findings may be labeled `Info`, `Low`, `Medium`, `High`, or `Critical`. Higher
severity findings contribute more strongly to risk level and audit status.

Low-confidence findings are hidden from the public audit rollup so the page
stays focused on useful evidence.

## What ClawHub checks

ClawHub audits submitted release artifacts, including:

- skill instructions or plugin metadata
- declared environment variables and permissions
- install instructions and package metadata
- included files and file manifests
- compatibility and capability metadata

The main question is coherence: do the name, summary, metadata, requested
authority, and actual content line up with what users would reasonably expect?

Powerful behavior is not automatically bad. Many useful tools need credentials,
local commands, provider APIs, or package installs. The audit checks whether that
power is expected, disclosed, and proportionate.

Artifact pages link to the full audit at:

```text
/<owner>/skills/<slug>/security-audit
```

The audit page combines:

1. SkillSpector
2. A.I.G
3. Risk analysis

## A.I.G

Skill audits include findings from Tencent Zhuque Lab's A.I.G scanner. A.I.G
checks agent instructions for vulnerability patterns and supplies supporting
evidence to ClawScan's artifact-wide review. It does not issue ClawHub's final
verdict or independently block installation.

A.I.G 0.2.1 cannot inspect packaged Python bytecode. Until Tencent ships its
[CVE-2026-84809](https://nvd.nist.gov/vuln/detail/CVE-2026-84809) fix, ClawHub
rejects skills containing `.pyc`, `.pyo`, or `.pyd` files before A.I.G runs.
ClawScan also detects packaged Python bytecode independently.

## Operator-only judge diagnostic

The manual **Nonproduction ClawScan judge diagnostic** workflow runs only from
`main`, on `blacksmith-16vcpu-ubuntu-2404`. Its `Production` environment supplies
existing CI key references, not registry access. It does not claim jobs, create
verdicts, publish artifacts, or call the production backend. Dispatch remains an
operator decision, not a recovery gate.

Choose `fixture=tiny` for a harmless control or `fixture=incident` for the exact
91 original files (317855 bytes) from `chinese-official-writing` version `2.0.43`.
`fixture=receipt-incident` selects only the two original files (10009 bytes) from
`onlinewebdirectory` version `1.0.1`, the selected-path receipt incident.
`fixture=small-timeout-paired` selects the one original `SKILL.md` (7877 bytes)
from `fitatu-diary` version `1.1.1`, the recovered small production-timeout input.
This scenario requires `source=reviewed`; it adds no URL, command, concurrency,
model, provider or transport inputs. All existing single-control choices retain
their original output shape and behavior.
The fixed public ZIP hash is checked **before decompression**, then every original
path, type, size and hash is verified. Only the known generated `_meta.json` and
`skill-card.md` entries are excluded. A changed archive fails closed; the public
ZIP is not the original VirusTotal ZIP. No package entrypoint is installed or run
by the harness.

`source=reviewed` uses `scripts/security/clawscan-source-commit.txt`;
`source=incident` selects only the installed incident revision
`e9d0e9e05506d9e9aa9725fe2f4da20e2870db9b`. Both use the existing source installer
and matched scanner installers. Runtime attestation checks source/binary identity,
Go 1.27.3, Python 3.12, Node 24.22.1, Codex 0.160.0, and the approved production
scanner settings before any provider invocation. Changed production scanner
settings require separate review, not silent substitution.

The process has a fresh `HOME`/`CODEX_HOME`, ENV-only keys, both progress opt-ins,
the unchanged ClawHub profile and read-only inner judge, a 900000-ms process cap
and at most 60000 ms for cleanup. Only `summary.json`, `events.jsonl` and
`attestation.json` are uploaded. They contain fixed enums, bounded numbers,
source/version pins and explicit environment differences—not raw output, prompts,
commands, errors or final artifacts. Raw artifacts and runtime state are ephemeral.
Missing or malformed final metadata leaves judge counts unknown, never zero.
Event loss/limits and unconfirmed group cleanup are explicit; progress cannot
establish a verdict, invocation count, provider cause or recovery.

### Fixed original-input scanner controls

`fixture=original-scanner-only, source=reviewed` selects exactly four controls in
order: `baseline175`, `candidate175`, `baseline290`, `candidate290`. Each runs
once, serially, without harness retries. Native judge execution is disabled:
the trusted installed SkillSpector CLI writes its own terminal JSON independently
of the final judge window. Scanner-only results are **not** full-profile acceptance.
Raw scanner stderr is drained without retention in this direct scanner mode;
the structured terminal file remains the evidence. This avoids imposing the
outer worker's stderr byte limit on output that production's Go adapter absorbs
internally. Other worker commands retain their stderr guard, and stdout,
process/cleanup budgets and terminal-file bounds remain unchanged.
Unknown process-group cleanup or setup failure stops later controls, retaining
their explicit `not_started_after_failure` statuses rather than overlapping them.

The baseline is production source `9662307780b2834791e2b0be8b166b44f4144ef4`.
The candidate must be a separately reviewed, exact source in
`scripts/security/clawscan-diagnostic-original.ts`; a null candidate fails closed
before source installation, input download or provider calls. This is a new
fixed selection, not an override of historical `reviewed`/`incident` semantics.
There is no arbitrary source SHA, URL, command, model or limit dispatch input.

The logical inputs are 175 original files / 2,530,728 bytes and 290 original
files / 14,953,416 bytes. Fixed metadata manifests hash compact JSON ordered by
path with property order `path,size,sha256`; historical fixtures retain their
different `path,sha256,size` canonicalization. The 175-file public ZIP is checked
against its own pinned hash, then **only** regenerated `_meta.json` is replaced
with the separately fetched, version-bound original 83-byte, hash-verified file.
The 290-file download is owner-qualified (`dong845`); only its extra generated
`_meta.json` is excluded. Every original path/type/size/hash is verified before
execution and again afterward; trees are read-only. No original compressed ZIP
identity is claimed, and no original program bytes are committed or uploaded.

Each side installs its own source-matched host runtime with the existing
`uv sync --locked --no-dev` path. Attestation records source/binary/adapter/tree/
lock/entrypoint hashes and actual runtime/SDK versions, including OpenAI 2.44.0
and LangChain OpenAI 1.3.3. No compatibility upgrade or Docker image is used
(`runtimeImage=N/A`). Python 3.12, Go 1.27.3, Node 24.22.1, Codex 0.160.0,
SkillSpector `95a52d8…`, Tencent `a5c5a72…`, Standard service and production
models/reasoning remain unchanged. The per-attempt 900s process + at most 60s
cleanup cap, upstream aggregate 600s and MCP artifact-count limit 128 remain.
Only this four-control mode has a 120-minute setup/job ceiling; other modes
retain the existing 80-minute ceiling.

For a **later, separate operator decision**, `fixture=original-candidate-full,
source=reviewed` selects at most one candidate ClawHub-profile process per input,
using the real ephemeral consumer validator and native read-only judge. It never
automatically follows scanner-only execution. Neither mode claims jobs, publishes
results or calls a backend API.

Collect only the workflow's `summary.json`, `events.jsonl`, `attestation.json`.
The original-mode summary identifies each attempt, monotonic timing, exit/cleanup,
input identity and terminal report hash/presence. Terminal projection includes
strict root execution success, completeness, bounded analyzer states/counts,
allowlisted reason-code counts and findings counts. Invalid/absent fields remain
unknown/failure, not zero/success; partial MCP `artifact_count_limit` results stay
partial. Limit attribution retains numeric bounds and hashed path, phase and
analyzer labels for at most 128 selected exception records, with at most 16
associated analyzer hashes per record. Total selected-reason counts remain
separate; truncation is explicit. Auxiliary-analyzer presence and finding-ID
cardinalities help investigate unknown enums and discrepant counts without
retaining source text or rewriting findings. These details do not change the
process or inspection completion checks.
Full-profile output additionally retains actual consumer acceptance,
fixed scanner/judge states and security verdict. Raw 0600 reports remain only in
restricted ephemeral runtime storage and are removed, never uploaded. Every
synthetic/nonpublishing control contributes **zero** production recovery samples.
Complete evidence does not mean benign: a complete finding-bearing report may
retain exit 1 and `processStatus=failed`; its actual exit, findings and verdict
are not rewritten as clean or as a zero operational-failure count.

### Fixed same-runner paired scenario

The paired scenario uses one runner job, with the same fresh probe-owned
`HOME`/`CODEX_HOME` and ENV-only credential route across every leg. Production
has persisted login state; this diagnostic deliberately does not create secret
files or reproduce that login/cache. Each process has a distinct input, working
directory, temporary directory and output. The unchanged Go runner creates its
own fresh judge workspace and random inspection challenge there.

The fixed order is `initial-singleton` (one full ClawScan process to terminal),
then `initial-four` (four separate full processes launched together to terminal).
All scan process groups must report absent before another leg starts. Unknown
cleanup stops the experiment, preserving results and marking later legs
`unevaluated`. A failed input preparation also stops without starting that leg.

If the initial singleton completes, passes the real consumer, and has zero
native operational failures, while any concurrent process fails/times out,
fails consumer validation, or exposes a native failure (even a recovered receipt
retry), run `confirmation-four` then `confirmation-singleton`. There are at most
10 scans, with no additional retries beyond the existing receipt behavior.
Each process still has a 900000-ms cap and 60000-ms cleanup allowance; only the
manual workflow job ceiling increases to 80 minutes for four legs and setup.

The paired `summary.json` has `schemaVersion=clawscan-paired-diagnostic-v1`, the
existing nonproduction/recovery/publication flags, fixed budgets, `maximumScans`,
`scansStarted`, `confirmationTriggered`, `fixture`, `identity`, `source`, and
`status` (`running`, `completed`, `cleanup_unconfirmed`, `orchestration_failed`).
Its four ordered `legs` contain `id`, `concurrency`, `status` (`unevaluated`,
`evaluated`, `not_required`) and `processes`. Each process contains a one-based
`processIndex`, runner-relative `startedAfterMs`/`finishedAfterMs`, and `result`:
the existing per-process safe diagnostic summary, plus `securityVerdict`
(`benign`, `suspicious`, `malicious`, or null) and `stages`. Stages independently
project `judge` and fixed `scanners` keys `clawscan-static`, `aig`, `skillspector`,
`endor` as `completed`, `failed`, `skipped`, or `unknown`. Missing/unrecognized
statuses remain unknown, including absent Endor. Stage projection does not imply
consumer acceptance or native invocation counts. Consumer rejection and every
raw process/native failure remain visible; no failures are subtracted after a
retry. Native counts come only from actual artifact provenance, never progress.
Malicious is a valid operational disposition, not a clean security verdict.

Each paired `events.jsonl` line is exactly the fixed envelope
`{schemaVersion:"clawscan-paired-event-v1",leg,processIndex,progress}`; `progress`
is the unchanged allowlisted `clawscan-progress-v1` projection. Indices are 1–4
(only 1 in singleton legs). Limits/drop counts remain per process; raw commands,
paths, headers, model text, errors and credentials are never added. Full raw
artifacts stay unmodified in the private ephemeral runtime for actual consumer
validation, never in uploaded output. The upload allowlist is unchanged.

`completed` describes orchestration, not operational health or recovery. If both
initial legs finish healthily, there is no reproduction, not proof of a fix.
A singleton stall shows concurrency four is not necessary. A repeated paired
difference is only an association with shared resources/order/account pressure,
not proof of a HOME, CPU, provider, transport or production concurrency cause.
Native turn-completed/error frames do not establish CLI exit, pipe EOF/drain or
wait ownership. These controls count zero recovery samples and change none of
the accepted timeout/judge, raw/conditional denominator, confidence, artifact,
lane, 24-hour, latency, queue or security requirements.

All output is `NONPRODUCTION_DIAGNOSTIC`, excluded from SLOs. A successful workflow
or control is not proof that the incident is fixed. Any relevant production
rollout still needs a new unchanged-version observation epoch and all existing
timeout, judge, unresolved, sample/confidence, latency, queue, artifact and security
gates.

The shared worker artifact validator accepts unversioned v1 inspection receipts
and explicit numeric v2 receipts. V2 retains the required file and the complete
additional inspected-file array, and binds the returned path, hash and challenge
to the final native attempt's provenance. Unsupported versions, mixed fields and
inconsistent or missing native provenance fail closed. Prepublication uses this
same validator, strips both progress opt-ins, and keeps inspection diagnostics out
of the stored public policy output. Legacy Endor profiles deliberately remain v1.

## Risk analysis

Risk analysis is powered internally by ClawScan, ClawHub's own security audit
system. It reviews each release as an agent-facing artifact: instructions,
metadata, declared permissions, files, capability signals, static scan signals,
SkillSpector findings, A.I.G findings for skills, and
publisher-provided context.
Static scan signals are internal context for this review; they are not a
standalone public audit section or install-blocking verdict.

Risk analysis uses the
[OWASP Agentic Skills Top 10](https://owasp.org/www-project-agentic-skills-top-10/)
as a lens for risks such as prompt injection, tool misuse, credential exposure,
unsafe execution, memory or context poisoning, and excessive agency.

ClawScan does not treat a scary-looking capability as automatically malicious.
It asks whether the capability is disclosed, purpose-aligned, and supported by
the release's stated use case.
