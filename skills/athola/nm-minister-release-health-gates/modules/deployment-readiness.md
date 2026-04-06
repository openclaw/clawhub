# Deployment Readiness Gate

## Required Inputs

- Deployment issue template filled out.
- Rollback steps included in PR description.
- Observability dashboard links validated.
- Support announcement drafted.

## GitHub Comment Skeleton

```
### Release <name> Readiness
- Scope freeze: <yes/no> (issue links)
- QA status: <check summary>
- Docs merged: <PR link>
- Support brief: <discussion link>
- Rollback owner: @handle
```

## Steps

1. Mirror this checklist in the deployment PR.
2. Use tracker CSV export to confirm no open `High` priority work in release scope.
3. Attach `status-report-template.md` excerpt for executive summary.
4. Capture final sign-offs as PR approvals and mention handles.

## Post-Deployment

- Update tracker tasks to `Done` and log actual effort.
- Create retro discussion referencing Release Gate comment.
- Archive artifacts under `docs/playbooks/release-train-health.md` references.
