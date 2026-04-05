# Status Digest Blueprint

## Inputs

- `ProjectTracker.get_status_report()` JSON payload.
- Optional GitHub Projects filter (lane, owner).
- Risk label queries (e.g., `label:risk-red state:open`).

## Steps

1. Pull tracker JSON.
2. Identify initiatives with completion < 80%.
3. For each initiative create:
   - 2 key wins (link to merged PRs).
   - 2 active risks (link to issues).
   - Updated ETA derived from due dates.
4. Drop summary into template:

```
### <Initiative>
- Wins: <PR 1>, <PR 2>
- Risks: <Issue 1>, <Issue 2>
- Next Milestone: <Date>
```

5. Include table of metrics using tracker values.

## Tips

- Use GitHub search queries so stakeholders can self-serve deeper context.
- Keep bullet count consistent each week for comparability.
- Add emoji tags to draw attention inside GitHub comments.
