# Package Publish Tooling Identity

The reusable package publish workflow may receive
`trusted_tooling_identity_json` when a caller must preserve reviewed workflow
tooling across a moving default branch. The identity names runs and revisions;
it does not select an authorization policy.

The version 2 object contains exactly:

- `version`: `2`
- `repository`: invoking workflow `owner/repo`
- `workflow`: `.github/workflows/plugin-clawhub-release.yml`
- `runId` and `runAttempt`: positive decimal strings for the invoking workflow
  execution
- `ref`, `fullRef`, and `sha`: exact invoking workflow ref and commit
- `toolingRef`, `toolingFullRef`, and `toolingSha`: either `main` /
  `refs/heads/main` plus its trusted commit, or an exact
  `release-publish/<sha12>-<decimal>` lightweight tag and commit
- `parentRepository`: release publisher `owner/repo`, which must match
  `repository`
- `parentWorkflow`: `.github/workflows/openclaw-release-publish.yml`
- `parentRunId` and `parentRunAttempt`: positive decimal strings for the exact
  release publisher attempt

The decimal suffix on a protected tooling tag records tag-creation provenance.
It is intentionally distinct from the invoking publish workflow `runId`.

## Parent Authorization Receipt

Supplying the identity also requires the parent run to upload one immutable
artifact named
`openclaw-clawhub-parent-authorization-<parentRunId>-<parentRunAttempt>`.
It contains `authorization.json` with exactly:

- `version`: `1`
- `kind`: `openclaw-clawhub-parent-authorization`
- `repository`, `workflow`, `runId`, and `runAttempt`: exact parent tuple
- `ref`, `fullRef`, and `headSha`: the parent's immutable GitHub context,
  including the complete `github.ref`
- `childWorkflow`: `.github/workflows/plugin-clawhub-release.yml`
- `authorizationRoute`: `automated-awaited` or `automated-detached`

The parent workflow chooses the route from its own release mode and writes the
receipt before child dispatch. The child identity cannot override it. The
verifier resolves the artifact by exact parent run and derived name, requires a
non-expired immutable artifact digest, and matches every receipt field to the
live parent run and trusted tooling tuple.

GitHub's run API may omit the ref qualifier from `path`; that field therefore
proves only the workflow path. The parent receipt is the authority for the full
ref. If the run API does include a qualifier, it must match the receipt.

## Recovery Approval Receipt

A human-dispatched recovery using a parent identity additionally requires the
designated child workflow's `approve_plugins_clawhub_release` job to finish
through the `clawhub-plugin-release` environment. That job uploads one
immutable artifact named
`openclaw-clawhub-recovery-approval-<childRunId>-<childRunAttempt>`.
It contains `approval.json` with exactly:

- `version`: `1`
- `kind`: `openclaw-clawhub-recovery-approval`
- the exact child repository, workflow, run, attempt, and non-bot actor
- `environment`: `clawhub-plugin-release`
- `approvalJob`: `approve_plugins_clawhub_release`
- `authorizationRoute`: `explicit-recovery`
- the exact parent run and attempt

The receipt is durable evidence that the trusted child workflow crossed its
protected environment gate. Bot-dispatched runs cannot select recovery, even
if a recovery artifact is present. A non-bot actor alone does not select
recovery; normal human-dispatched releases keep the parent-owned automated
route. Failed-parent recovery without this artifact fails closed.

## State And Mutation Rules

The verifier derives the state policy from the evidenced route:

- `automated-awaited`: parent must remain `in_progress`
- `automated-detached`: parent may be `in_progress` or `completed/success`
- human recovery with a valid environment receipt: parent may be
  `in_progress`, `completed/success`, or `completed/failure`

Cancelled parents are never accepted.

The package publish CLI invokes the verifier at each mutation boundary: once
immediately before requesting staged storage, again before uploading the staged
ClawPack, and again immediately before `POST /api/v1/packages`. Authorization-
bound mutations use one network attempt per verification instead of retrying
after the check. Each invocation re-reads the child attempt, both receipt
artifact identities, the parent attempt, and then:

- requires the main-route tooling SHA to remain an ancestor of current `main`;
  or
- re-reads the protected tag and requires an exact lightweight
  tag-to-commit match.

Moved, deleted, or annotated tags fail closed. Wrong repositories, workflows,
runs, attempts, actors, events, refs, SHAs, artifact origins, artifact digests,
routes, environments, jobs, parent states, or conclusions also fail closed.
Unknown fields and future versions fail closed so contract evolution remains
explicit.

The input remains optional for ordinary reusable-workflow callers. Automated
real publishes from `openclaw/openclaw` at this workflow revision require a
non-empty version 2 identity. OpenClaw must land the receipt producers and
identity update before moving its pinned ClawHub workflow SHA to this revision;
the existing pinned version 1 route remains untouched until that coordinated
pin update.
