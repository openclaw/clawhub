# Quality Signals Gate

## Checklist

- [ ] Required GitHub checks green for 24h.
- [ ] Integration tests rerun after last commit.
- [ ] Flaky tests triaged with tracking issue link.
- [ ] Performance benchmarks attached to PR comment.
- [ ] Error budget impact reviewed with SRE.

## Data Sources

| Signal | GitHub Source | Notes |
|--------|---------------|-------|
| Checks | `GET /repos/{owner}/{repo}/commits/{sha}/check-suites` | Store snapshot hash in tracker notes. |
| Deployments | `GET /repos/{owner}/{repo}/deployments` | Validate staging + prod status. |
| Issues | label:`qa-blocker` | Drive gating conversation. |

## Escalation Path

1. If any check fails, tag `@release-captain` + owning engineer in PR.
2. Log blocker in tracker with `status="In Progress"` and pointer to GitHub artifact.
3. Update Release Gate comment with mitigation ETA.
