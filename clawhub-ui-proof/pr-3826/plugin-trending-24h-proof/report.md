# ClawHub UI Proof
Status: pass
Mode: `feature`
Scenario: `/Users/patrickerichsen/Git/openclaw/clawhub-plugin-trending/.artifacts/proof-scenarios/plugin-trending-24h.mjs`
Baseline: not run for feature proof.
Candidate: `worktree`
Runner: `local`
Provider: `local`
## Artifacts
### candidate

- Output: `/Users/patrickerichsen/Git/openclaw/clawhub-plugin-trending/.artifacts/plugin-trending-24h-proof/candidate`
- pass: 24-hour API and displayed totals exclude the former weekly leader - `candidate/screenshots/24-hour-api-and-displayed-totals-exclude-the-former-weekly-leader.png`
- pass: Load more preserves ranking and excludes old activity - `candidate/screenshots/load-more-preserves-ranking-and-excludes-old-activity.png`
- pass: Search filters 24-hour ranking and closing restores it - `candidate/screenshots/search-filters-24-hour-ranking-and-closing-restores-it.png`
- pass: Responsive mobile - `candidate/screenshots/responsive-mobile.png`
- pass: Responsive tablet - `candidate/screenshots/responsive-tablet.png`
- pass: Responsive laptop - `candidate/screenshots/responsive-laptop.png`
- pass: Responsive desktop - `candidate/screenshots/responsive-desktop.png`


Local URL: http://127.0.0.1:4319. Isolated Convex cloud/site ports: 4419/4519. Fixture: `devSeedPackageTrending:seedInternal`, 25 recent plugins and one former weekly leader whose 40 downloads precede the window. All seven browser steps passed. The bootstrap initially reported a Node compile-cache cleanup race after successful proof; cleanup was retried, the temporary state was removed, and all three ports were verified closed.

## Existing-data upgrade and capacity follow-up

Source: `3e5183a820` (same visible UI as the screenshots, with the upgrade fallback). Production was queried read-only; the changed backend was exercised only on an isolated local instance.

### Production volume

```json
{
  "deployment": "wry-manatee-359",
  "readOnly": true,
  "measuredAt": "2026-09-26T07:35:38.404Z",
  "startAt": 1790319600000,
  "endAt": 1790406000000,
  "totalRetainedRows": 57907,
  "windowRows": 8172,
  "totalRetainedBytes": 11447888,
  "pages": 12
}
```

### Local upgrade and capacity

```json
{
  "target": "isolated local",
  "measuredAt": "2026-09-26T07:36:33.581Z",
  "before": {
    "first": "trending-proof-weekly-leader",
    "rows": 1,
    "has24hMetrics": false
  },
  "seed": {
    "inserted": 200000,
    "window": 100000
  },
  "seedDurationMs": 43715,
  "indexPushAndBackfillMs": 330743,
  "afterIndexBeforeRebuild": {
    "first": "trending-proof-weekly-leader",
    "rows": 1,
    "has24hMetrics": false
  },
  "rebuild": {
    "count": 25,
    "ok": true
  },
  "rebuildDurationMs": 55318,
  "after": {
    "first": "trending-proof-00",
    "rows": 25,
    "windowDownloads": 100325,
    "firstMetrics": {
      "downloads": 4025,
      "installs": 0,
      "windowEnd": 1790406000000,
      "windowStart": 1790319600000
    }
  }
}
```

### Continuous API availability

```json
{
  "startedAt": "2026-09-26T07:38:58.922Z",
  "checks": 115,
  "emptyResponses": 0,
  "failedRequests": 0,
  "legacyResponses": 114,
  "currentResponses": 1,
  "maxLatencyMs": 4987,
  "completedAt": "2026-09-26T07:43:46.873Z",
  "runtimeCompleted": true
}
```
