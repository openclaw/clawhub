---
summary: "Version-bound, AI-inferred intermediary requirements for skills and plugins"
read_when:
  - Changing artifact inspection, intermediary metadata, or listing disclosures
---

# Intermediary disclosure

## Public contract

- `requiresIntermediary: true | false | null`
- `intermediaryDetails: string | null`

An intermediary is an additional third-party service that brokers authentication
or application access for the advertised offering, including authentication
brokers and hosted connectors. Identify that offering from the artifact's name,
description and actual workflow together, not just the ultimate app reached.
The advertised service itself, local software dependencies, and its ordinary
first-party infrastructure do not count. Free and paid intermediaries count equally.

`true` means a required intermediary was found for the advertised integration.
`false` means inspection supports a working path without one, or a purely local
workflow. Supported direct/self-hosted alternatives make a hosted intermediary
optional; explain the alternative rather than marking that service required.
`null` means uninspected, incomplete, failed, or inconclusive. Never derive `false`
from missing metadata or a clean security verdict.

### Advertised app versus advertised platform

An Outlook-specific skill requiring fictional RelayBridge or Composio is `true`, including one
called "Outlook via RelayBridge". Naming the broker in a title, publisher, homepage or
setup step does not turn it into the target or remove the dependency. A local
CLI may require a hosted broker; classifying the CLI as local software must not
hide the remote service. Managed OAuth, no API key, a free account and Microsoft
Graph-shaped API paths are not evidence of a direct Microsoft connection.

A genuinely platform-focused offering, such as Composio's multi-app CLI/SDK and
tool-routing platform, may be `false` with respect to Composio itself. Its details
must still explain the Composio account and mediated app access: `false` means no
**additional** broker beyond the advertised platform, not no account or direct
access to every app. This is not a vendor allowlist; an additional broker behind
that platform still counts. A renamed Outlook-only wrapper is still app-specific.
If the advertised offering is ambiguous, use `null` rather than guessing.

A direct/self-hosted alternative must be documented and usable within this
artifact's supported workflow. A raw HTTP fallback through the same gateway, an
upstream API reference, or a hypothetical rewrite does not establish an alternative.

### Fictional regression example

An Outlook integration advertises Microsoft Outlook/Microsoft Graph access but
requires fictional RelayBridge. One fixture sends calls to
`gateway.relaybridge.example/outlook/...`, requires `RELAYBRIDGE_API_KEY`, and
directs users to create a RelayBridge account and authorize Outlook through its
connection flow. Another documents a RelayBridge CLI login and a raw-HTTP fallback
to `api.relaybridge.example`; neither route bypasses RelayBridge. Both must be
`true`, with RelayBridge named in the explanation. Describe the documented
dependency without labeling the publisher malicious, dishonest or unsafe.

These fictional cases test the workflow, not a keyword rule for Outlook,
RelayBridge or a particular publisher. An explicitly Composio-branded platform
offering is the contrasting negative control, not an equivalent case.

## Extraction and lifecycle

ClawHub owns a companion structured Responses extraction after successful
ClawScan inspection. It does not alter ClawScan upstream, override the security
judge, execute artifact code, or require publisher declarations. Both the
prepublication worker and the queued scan/rescan worker invoke the same helper.

The helper reads SKILL.md, README, manifests and supporting source from the exact
materialized artifact. File count, traversal depth, per-file bytes and total
bytes are bounded; symlinks are not followed. The model receives the inspected
text as ordered, bounded excerpts with request-local source IDs. It selects IDs;
ClawHub derives each quote and file path from the exact inspected content, never
from a model-authored quote or filename. Unknown IDs and blank excerpts yield
unknown. This avoids citation-copying errors without accepting approximate text
matches; semantic relevance of the selected evidence still requires evaluation.
Omitted/opaque content prevents a negative conclusion. All artifact text is
untrusted evidence, not instructions to the extractor. Remote retention or
credential-storage practices must not be invented from client-side requests.

Store the result under the version/release's `llmAnalysis.intermediaryAnalysis`,
including model, extraction recipe, timestamp, and bounded file evidence. This
uses the existing exact-artifact result promotion and deletion lifecycle; it
creates no new table or retention job. Replacing a scan replaces this metadata,
including an explicit unknown result on extraction failure. Old worker results
without the field remain unknown rather than retaining a previous conclusion.

Extraction errors must not fail publication, change a security verdict, quarantine
a package, or change installability. API-key absence also yields unknown.
Extraction is cached version metadata, never an on-demand listing-page LLM call.

The extraction model defaults to `gpt-6-luna`, low reasoning, Standard service,
with `INTERMEDIARY_MODEL` as an explicit worker override. Calls use the worker's
`OPENAI_API_KEY`, a 60-second timeout and `store: false`. No live model call is
required for local fixtures/tests.

## Prompt regression evaluation

`scripts/security/infer-intermediaries.test.ts` includes opt-in live contract
cases, including fictional RelayBridge-backed Outlook workflows,
platform branding, app wrappers that mention their broker, direct/self-hosted
alternatives and an extra broker behind a platform. Normal CI does not call a
paid API. Run the real helper against those controls with:

```sh
INTERMEDIARY_LIVE_EVAL=1 bunx vitest run scripts/security/infer-intermediaries.test.ts
```

This requires the worker's `OPENAI_API_KEY` and calls OpenAI from a local runner;
it is not offline inference. These compact controls do not replace full-artifact
evaluation. Pin real ClawHub inputs by owner, exact version and every file's
SHA-256; download all version files through the public file API and check hashes.
Keep the old prompt and results intact while comparing candidates using identical
inputs/model settings. Check HTTP success, model abstention and validator rejection
separately, inspect explanations and quotes, and include negative controls and
unseen vendor/workflow combinations. Repeated runs are not independent cases or
a catalog-wide accuracy estimate. Keep detailed outputs under ignored
`.artifacts/`, not on a proof branch, and never turn evaluation into production
rescans or database writes.

## Consumers and rollout

Skill detail/list APIs expose the two fields for the selected public latest
version; exact-version APIs expose the requested version. Plugin detail metadata
and exact-release APIs expose the corresponding selected release. Additive schema
readers accept older servers. Hosted-feed schema versions and search filters are
unchanged; cross-repository feed changes are outside this first implementation.

Skill and plugin detail pages show Required intermediary: Yes / No / Unknown,
details, and an AI-inferred attribution for determinate results. Missing inspection
must remain visibly unknown. This is not a trust or security badge.

Existing records need no fabricated backfill. Existing bounded rescan jobs can
populate the metadata when an operator chooses to run them; merging this code
must not automatically start a catalog-wide rescan.

For local browser checks, `devSeed:seedIntermediaryFixtures` creates required,
direct and unknown skills/plugins owned by the existing local persona. These
results are explicitly synthetic (`local-fixture-not-an-llm-inspection`), not proof
of a live model's classification quality.
