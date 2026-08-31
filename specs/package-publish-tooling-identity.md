# Package Publish Tooling Identity

OpenClaw automated package publication uses a version 2 identity plus an
immutable parent authorization receipt. The identity describes the child,
candidate, tooling, and parent. It cannot select an authorization policy.

The version 2 identity contains exactly:

- `version`: `2`
- `repository`: `openclaw/openclaw`
- `workflow`: `.github/workflows/plugin-clawhub-release.yml`
- `runId` and `runAttempt`: exact child run attempt
- `ref`, `fullRef`, and `sha`: exact child workflow ref and commit
- `candidateRepository` and `candidateSha`: frozen package payload source
- `toolingRef`, `toolingFullRef`, and `toolingSha`: reviewed release tooling
- `parentRepository`: `openclaw/openclaw`
- `parentWorkflow`: `.github/workflows/openclaw-release-publish.yml`
- `parentRunId` and `parentRunAttempt`: exact release parent attempt

The candidate SHA may differ from the child and tooling SHA. This split-ref
route lets reviewed tooling publish packages built from a frozen release
candidate without pretending that the candidate executed the workflow.

## Parent Authorization Receipt

The parent uploads the receipt only after it has discovered the dispatched
child run and exact package transactions. The artifact name is:

`openclaw-clawhub-parent-authorization-v2-<parentRunId>-<parentRunAttempt>-<childRunId>-<childRunAttempt>`

The archive contains only `authorization.json`. Its version 2 object contains
exactly:

- parent repository, workflow, run, attempt, ref, full ref, and head SHA
- child repository, workflow, run, attempt, ref, full ref, and head SHA
- candidate repository and SHA
- tooling ref, full ref, and SHA
- `authorizationRoute`: `automated-awaited` or `automated-detached`
- non-empty `packages`: exact `{name, version, inventoryDigest}` transactions

The parent receipt is bounded at 64 KiB of UTF-8 JSON, matching the backend,
with at most 512 package transactions. Workflow file preflight and JSON parsing
both enforce that limit. Child identity and recovery approval receipts retain
their separate 8 KiB workflow bounds.

The inventory digest is SHA-256 over package files sorted by path. Each line is
`<path>\0<size>\0<lowercase file sha256>`, joined with `\n`.

ClawHub resolves the artifact from the exact parent run, verifies the GitHub
artifact SHA-256 before reading it, requires the archive to contain only the
receipt, and matches every field to the live child, parent, candidate, tooling,
and requested package transaction.

GitHub's run API does not prove the complete ref qualifier. The receipt is the
full-ref authority; run metadata must not be used to infer it.

## Recovery Approval Receipt

Failed-parent recovery is a separate, canonical route. The child must be a
direct human dispatch and must cross the `clawhub-plugin-release` environment
through the `approve_plugins_clawhub_release` job. That job uploads:

`openclaw-clawhub-recovery-approval-<childRunId>-<childRunAttempt>`

The archive contains only `approval.json`, binding the exact child and parent
attempts, actor, environment, approval job, and `explicit-recovery` route.
Actors typed as `Bot` or `App`, and logins ending in `[bot]`, cannot recover.
The identity cannot request recovery.

## State Policy

ClawHub derives parent state policy from the evidenced route. Submission and
public visibility are separate boundaries:

- submission:
  - `automated-awaited`: parent must be active
  - `automated-detached`: parent may be active or completed successfully
  - `explicit-recovery`: parent may be active, successful, or failed
- public finalization:
  - both automated routes require the exact parent attempt to be completed
    successfully
  - explicit recovery requires the exact parent attempt to be completed
    successfully or failed with the protected recovery evidence

Cancelled parents are never authorized. Unknown routes, states, conclusions,
fields, and versions fail closed. An active parent can authorize only a
non-public staged release.

## Server Authorization

Workflow and CLI checks are diagnostics. They do not authorize a registry
mutation.

For each upload or publish credential request, ClawHub verifies GitHub OIDC,
the exact v2 identity, the live child and parent attempts, immutable receipts,
the package transaction, and the current tooling ref. It then mints a
short-lived credential bound to:

- upload or publish scope
- child run and attempt
- parent run and attempt
- candidate repository and SHA
- package name, version, and inventory digest
- receipt artifact id and digest
- derived authorization route

Each scope can be minted once for an exact authorization transaction. Replay
and cross-package, cross-version, or changed-inventory minting fail closed.
The server records a first-class transaction key on each scoped credential.
Large-artifact upload tickets bind to that key, so the upload-scoped credential
that creates the ticket and the distinct publish-scoped credential that
consumes it must prove the same repository, workflow run attempt, package,
version, and inventory transaction. Fresh ticket consumption rechecks token
scope, expiry, revocation, consumption, and OpenClaw v2 authorization. A retry
may reuse the same ticket only for the exact storage object already recorded.

Immediately before staging, the ClawHub server repeats the live v2 verification
from the identity stored with the publish credential. The mutation then
rechecks the credential, current trusted-publisher config, package, version,
inventory, expiry, and consumption state, and consumes the credential in the
same Convex transaction as the non-public release insert. A failed mutation
rolls back consumption.

Version 2 OpenClaw publishes always use staged publication. After security
checks pass, the finalizer revalidates the stored exact transaction and
requires the parent attempt to have reached an immutable authorized terminal
outcome. The pending release itself stores its consumed v2 token and inventory
binding. The promotion mutation atomically rereads that token, its revocation
state, package/version/inventory transaction, and current trusted publisher
before changing the release to public. Active parents remain pending. Cancelled
or otherwise unauthorized terminal parents fail the attempt while the release
remains non-public. GitHub API or other transient verification failures remain
retryable. The scheduled pre-publication worker retries ready finalizations
every five minutes.

The terminal outcome removes the cross-system cancellation race: successful
GitHub Actions run attempts do not become cancelled after completion, so the
subsequent Convex publication mutation cannot outlive a mutable active-parent
authorization.

The package source recorded by the registry comes from
`candidateRepository`/`candidateSha`, not the tooling workflow SHA.

## Manual Route And Cutover

Ordinary callers remain compatible. Every OpenClaw GitHub Actions OIDC publish
requires v2, including the pre-cutover reusable-workflow revision. The only
non-v2 OpenClaw route is a directly authenticated ClawHub user supplying an
explicit manual override.

OpenClaw must add the v2 identity, post-dispatch parent receipt, package
inventory list, and child inputs before this server gate is deployed. The v2 child must
accept the staged response instead of waiting inline for publication, so the
awaited parent can finish successfully. Published-artifact verification must
run from a detached post-parent route after ClawHub finalization, not from the
still-awaited child run. Merge and deployment of the ClawHub verifier alone
must not move the OpenClaw pin.
