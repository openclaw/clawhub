# Package Publish Tooling Identity

The reusable package publish workflow may receive
`trusted_tooling_identity_json` when a caller must preserve reviewed workflow
tooling across a moving default branch.

The version 1 object contains exactly:

- `version`: `1`
- `repository`: trusted tooling `owner/repo`
- `workflow`: trusted tooling workflow path under `.github/workflows/`
- `runId` and `runAttempt`: positive decimal strings for the trusted tooling
  workflow execution
- `ref` and `fullRef`: either `main` / `refs/heads/main` or an exact
  `release-publish/<sha12>-<decimal>` lightweight tag
- `sha`: the exact trusted tooling workflow commit

The decimal suffix on a protected tooling tag records tag-creation provenance.
It is intentionally distinct from the later approving workflow `runId`.

When present, the workflow requires the caller repository to match the tuple,
then verifies the trusted tooling run directly through GitHub. Immediately
before package publication, it then:

- requires the main-route SHA to remain an ancestor of current `main`; or
- re-reads the protected tag and requires an exact lightweight
  tag-to-commit match.

Moved, deleted, or annotated tags fail closed. A wrong repository, run,
attempt, workflow, event, ref, or SHA also fails closed. A same-name branch
does not satisfy the protected-tag route. Unknown fields and future versions
also fail closed so contract evolution remains explicit.

The input is optional for compatibility with ordinary reusable-workflow
callers. Release workflows that depend on frozen tooling must supply it.
