# Package Publish Tooling Identity

The reusable package publish workflow may receive
`trusted_tooling_identity_json` when a caller must preserve reviewed workflow
tooling across a moving default branch.

The version 2 object contains exactly:

- `version`: `2`
- `repository`: invoking workflow `owner/repo`
- `workflow`: invoking workflow path under `.github/workflows/`
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
- `parentRef`, `parentFullRef`, and `parentSha`: the release publisher's exact
  tooling tuple, which must match `toolingRef`, `toolingFullRef`, and
  `toolingSha`
- `parentStatePolicy`: one of the explicit state policies below

The decimal suffix on a protected tooling tag records tag-creation provenance.
It is intentionally distinct from the invoking publish workflow `runId`.

When present, the workflow binds the tuple to the live invoking GitHub context
and re-reads both the exact invoking workflow attempt and exact release parent
attempt through GitHub. The release parent repository, workflow path, run,
attempt, ref, head SHA, status, and conclusion all fail closed on mismatch.

The parent-state policies are:

- `active`: only `in_progress` with no conclusion. Automated release
  orchestration uses this while it still owns and awaits the child.
- `active-or-success`: either active or `completed/success`. Detached normal
  ClawHub publication uses this because the release parent may finish
  successfully while the child waits for environment approval.
- `recovery-active-or-success-or-failure`: active, `completed/success`, or
  `completed/failure`. This is only for an explicit operator recovery routed
  through the child workflow's own environment approval.

Cancelled parents are never accepted. A failed parent is accepted only by the
explicit recovery policy. Missing or unknown policies fail closed.

Immediately before each package publication, the verifier then:

- requires the main-route tooling SHA to remain an ancestor of current `main`;
  or
- re-reads the protected tag and requires an exact lightweight
  tag-to-commit match.

Moved, deleted, or annotated tags fail closed. A wrong repository, run,
attempt, workflow, event, ref, SHA, parent state, or parent conclusion also
fails closed. A same-name branch does not satisfy the protected-tag route.
Unknown fields and future versions also fail closed so contract evolution
remains explicit.

The input is optional for compatibility with ordinary reusable-workflow
callers. Release workflows that depend on frozen tooling must supply it.
