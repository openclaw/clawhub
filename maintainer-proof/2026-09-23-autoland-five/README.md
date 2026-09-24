# Maintainer proof for ClawHub PRs 3762, 3758, and 3771

These retained native Convex runs are paired before/after evidence, originally run against main `2c901bdf46ef9a75a1702616e6c0f3c5b9361be3` and the exact submitted production hunks. They are not new production observations. On September 23 the same changes merged cleanly into current main `826992bd72b9f9ab09254dc43551facdf94cb07b`; the combined integration passed 7,195 tests, static checks, Convex deploy typechecking, schema/CLI TypeScript, and the production build.

| PR | Before | After | Native evidence |
|---|---|---|---|
| [3762](https://github.com/openclaw/clawhub/pull/3762) | Anonymous and ordinary members requeue a populated skipped evaluation and schedule dispatch | Both denied with unchanged row/dispatcher; admin still schedules | 42 assertions; [record](3762/run.json), [fixture](3762/fixture.ts), [receipt](3762/assessment.json) |
| [3758](https://github.com/openclaw/clawhub/pull/3758) | Removed org member receives 423 owner hint and 200 private evidence; a different current member receives 404 | Former member gets 404/404; current member gets 423/200; personal linkage and legacy controls preserved | 64 assertions, 32 HTTP requests; [record](3758/run.json), [fixture](3758/fixture.ts), [receipt](3758/assessment.json) |
| [3771](https://github.com/openclaw/clawhub/pull/3771) | Revoke/quarantine select pending 5.0.0 and break default file/ZIP downloads | Select legacy 1.0.0 with 200 file/ZIP, or clear pointers/hide when no eligible survivor exists | 96 assertions, 48 HTTP requests, 10 decoded ZIPs; [record](3771/run.json), [fixture](3771/fixture.ts), [receipt](3771/assessment.json) |

All data and identities are synthetic local fixtures. Evaluation dispatch jobs were scheduled behind an owned 24-hour lease, inspected, and cancelled; no external worker was dispatched. The skill fallback proof also includes blocked and owner-withdrawn siblings. Pending bytes were already denied by the baseline's shared readers; this proof does not claim an unpublished-byte leak on current main.

Limitations: direct standalone Convex authentication/HTTP, not identity-provider login, browser/CDN, production deployment, or historical production-data repair. Each JSON records exact source fingerprints and cleanup. Additional spec-only commits document the evaluation and HTTP-read permission invariants; they do not change the proven runtime hunks.
