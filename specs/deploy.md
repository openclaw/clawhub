---
summary: "Maintainer deploy checklist: Convex backend, Vercel web app and PR previews, CLI npm release, and API routing."
---

# Deploy

This is a maintainer runbook for the ClawHub project. It is intentionally kept
under `specs/` so it does not publish into the user-facing ClawHub docs tab.

ClawHub is two deployables:

- Web app (TanStack Start) -> typically Vercel.
- Convex backend -> Convex deployment (serves `/api/...` routes).

## 1) Deploy Convex

From your local machine:

```bash
bunx convex env set APP_BUILD_SHA "$(git rev-parse HEAD)" --prod
bunx convex env set APP_DEPLOYED_AT "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" --prod
bunx convex deploy
```

Or use the GitHub Actions pipeline:

```bash
gh workflow run deploy.yml --repo openclaw/clawhub --ref main
```

Production deploy notes:

- `deploy.yml` is manual-only (`workflow_dispatch`). Merging to `main` does not deploy.
- The workflow must be started from `main`.
- The catalog-taxonomy digest and high-/medium-confidence classification rollout migrations were
  one-time production operations and are no longer part of the deploy checklist.
- While `migrations:runCatalogMetadataCanonicalization` exists, backend deploys that include it require
  an operator to dry-run, explicitly apply, and verify both tracked migrations before inferred-topic
  and inferred-category compatibility can be removed:

  ```bash
  bunx convex run migrations:runCatalogMetadataCanonicalization '{"dryRun":true}' --prod
  bunx convex run migrations:runCatalogMetadataCanonicalization \
    '{"dryRun":false,"confirm":"canonicalize-catalog-metadata"}' --prod
  bunx convex run --component migrations lib:getStatus --watch --prod
  ```

- Deploy targets:
  - `full`: deploy Convex, verify contract, wait for the matching Vercel production deploy, then run smoke tests
  - `backend`: deploy Convex, verify contract, then run smoke tests against current production
  - `frontend`: wait for the Vercel production deploy for the selected `main` SHA, then run smoke tests
- skills.sh synchronization first takes the workflow-level `skills-sh-sync-${{ github.ref }}`
  concurrency group with `queue: single` and `cancel-in-progress: false`. Each ref keeps one active
  sync workflow and only the latest pending request. Scheduled and same-ref manual requests both
  coalesce: a newer request replaces an older pending request without cancelling the active sync.
- The entire sync job then takes the `deploy-production` group shared with production deployments.
  Its `queue: max` retains up to 100 pending jobs or workflows without cancelling the active holder,
  so a sync cannot replace a queued manual deploy. A sync waiting for this group still holds its
  outer group; each ref contributes at most one sync job waiting for or holding the production lock,
  plus one pending sync workflow outside it. Lock order is sync group then production group;
  deployment takes only the production group. Both groups remain held through sync cleanup and proof
  upload, and the production group covers deployment rollout restoration. Neither workflow
  dispatches or waits for the other while holding the group. Existing queued runs retain the workflow
  definition they started with. Job timeouts remain 180 minutes for synchronization and 45 minutes for
  deployment; either can wait behind the other, including frontend deployment readiness checks.
- The sync CLI writes `skills-sh-sync-proof.json` before exiting nonzero on failure. Failure receipts
  contain `ok: false`, a redacted primary `error`, and separately redacted `rollbackErrors`, with each
  message capped at 2,000 characters plus a truncation marker. `rollbackErrors: null` means execution
  failed before the rollback scope; an empty array means the attempted rollback completed without
  error. A failed artifact write remains a failure and is not retried.
- Ordinary backend deploys require both external-skill rollout modes to be missing or `off`.
  When either rollout is intentionally active, use a backend-only deploy and set
  `active_rollout_deploy_confirm=pause-and-restore-active-rollouts`. The workflow records the
  exact active modes, pauses them before deploying Convex, and restores and verifies them before
  production HTTP smoke. The restore steps run even when deployment or dark-state verification
  fails.
- Temporary exception authorized by Patrick on 2026-10-05: [PR #3911](https://github.com/openclaw/clawhub/pull/3911)
  permits one controlled backend deployment while skills.sh stays enabled and a real sync progresses.
  Dispatch `skills-sh-sync.yml` from reviewed `main` with `deploy_experiment_sha`, exact successful
  `deploy_experiment_ci_run` and `deploy_experiment_test_run`, and
  `deploy_experiment_confirm=deploy-once-with-enabled-skills-sh`. Only Patrick's first attempt of the
  earliest immutable experiment run, excluding only proven first-attempt cancellations with zero jobs,
  is eligible. A prior first-attempt cancellation
  is excluded only after a live GitHub jobs read proves it had zero jobs. A started job or rerun still
  consumes the single attempt. The experiment uses a separate outer queue so recurring schedules
  cannot replace it, but retains the shared `deploy-production` job mutex. Ordinary sync queueing is
  unchanged. All other release gates remain: the existing
  Production environment, production mutex through both processes and cleanup, unchanged rollout
  boundaries, typechecks, promotions/contract verification, and production HTTP smoke. The sync child
  uses its existing OIDC identity without the deploy credential. Record prior backend SHA and rollout,
  active durable sync progress, actual deployment logs, catalog reads during/after deployment, and
  complete sync accounting. Stamp revision metadata only after successful deployment; investigate
  failures and reconcile the actual deployed code before using the existing rollback procedure.
  Remove the temporary inputs and supervisor after that attempt and evidence reconciliation. The
  ordinary pause/restore guard remains; a successful experiment does not establish every future
  deployment is safe without a pause.
- `frontend` does not call `vercel deploy` directly yet. It relies on the existing Vercel Git-based production deploy for that SHA.
- The real deploy job uses the GitHub `Production` environment for deploy secrets, but it does not wait for a separate approval.
- Required `Production` environment secret: `CONVEX_DEPLOY_KEY`.
- Optional `Production` environment secret: `PLAYWRIGHT_AUTH_STORAGE_STATE_JSON` for authenticated smoke coverage.

### Staging branch deploys

Pushing `staging` starts the same CI as `main` and a separate staging deploy
workflow at that exact SHA. The deploy waits for that staging push CI run to
complete successfully before touching the backend. GitHub can run a `push`
workflow that exists only on `staging`, so this path can be proven before merging
the workflow into `main`. The GitHub `Staging` environment permits only the
`staging` branch.

After the workflow is merged into `main`, a manual dispatch can use the current
full staging SHA:

```bash
staging_sha="$(git ls-remote origin refs/heads/staging | awk '{print $1}')"
gh workflow run deploy-staging.yml --repo openclaw/clawhub --ref staging \
  -f expected_sha="$staging_sha"
```

GitHub requires `workflow_dispatch` workflows to exist on the default branch.
Before that merge, rerun the staging push workflow from its Actions run page
only if its SHA has not already created a Vercel Preview deployment. Reruns
and manual dispatches reject an already deployed SHA before changing Convex.
The first attempt of a staging push skips that guard because the same commit
may already have a PR Preview deployment. For environment-only changes, push a
new staging commit and let its exact-SHA CI pass before deploying it.

The deployment checks that the selected, checked-out, and current remote SHAs
match. Before first use, fast-forward the formerly stale `staging` branch to a
current `main` descendant. Its previous code contained a Vercel rewrite to the
production API; the workflow also requires the safe baseline commit, the
environment-aware `build:vercel` entrypoint, and no static rewrites. It does
not require staging to contain every future `main` commit.

One-time target configuration:

- Convex project `amantus/clawhub-staging`, deployment `cheery-civet-733`.
  Its `prod:cheery-civet-733|...` deploy key is scoped to the staging Convex
  project, not ClawHub production or permanent Test.
- Vercel project `openclaw-foundation/clawhub`: attach its Preview environment
  variables to the `staging` branch. Set `CLAWHUB_ENV=staging`, the paired
  `VITE_CONVEX_URL=https://cheery-civet-733.convex.cloud` and
  `VITE_CONVEX_SITE_URL=https://cheery-civet-733.convex.site`, and the same
  `SITE_URL`/`VITE_SITE_URL` as the GitHub `Staging` environment. Set a random,
  at least 32-character `CLAWHUB_STAGING_EDGE_SECRET` only on the `staging`
  branch and set the same value on `cheery-civet-733`. The server sends it only
  to that Convex site, and Convex requires it alongside Vercel OIDC before
  trusting visitor IPs or issuing archive manifests. Other Preview branches
  share Vercel's project/environment OIDC identity and must not receive this
  secret; keep Vercel's Git fork protection enabled. Do not give this frontend
  a Convex deploy key. The build verifies the branch, both site URL variables,
  backend URLs, edge secret, and matching deployed SHA before it runs; it never
  creates or seeds a Convex Preview deployment. `CLAWHUB_ENV=staging` remains
  the branch marker when Vercel reports its system `VERCEL_TARGET_ENV` as
  `preview`.
- The Vercel Deploy Hook named `clawhub-staging-github-actions` is bound to the
  `staging` branch. `vercel.json` disables automatic Git builds only for this
  branch; CI invokes the hook after the backend is ready. Do not set the
  deprecated `github.enabled=false`, which disables hooks too.
- GitHub `Staging` environment: permit the `staging` branch only. Set variables
  `VERCEL_PROJECT_ID=prj_UVAJPNPYrBwTEkPJwkpEySsge8Mc`,
  `VERCEL_SCOPE=openclaw-foundation`, `VITE_CONVEX_URL`,
  and `VITE_CONVEX_SITE_URL`. Set `SITE_URL` for a custom staging domain;
  otherwise the workflow uses the stable Git branch URL
  `https://clawhub-git-staging-openclaw-foundation.vercel.app`. Allowed custom
  domains are `https://stg.clawhub.openclaw.org` (temporary public hostname)
  and `https://stg.clawhub.ai` (pending DNS verification). Set secrets
  `CONVEX_DEPLOY_KEY`, `VERCEL_DEPLOY_HOOK_URL`, and
  `VERCEL_AUTOMATION_BYPASS_SECRET`. The bypass secret lets the API and UI smoke
  tests reach SSO-protected Preview URLs.
- [Vercel automation bypass secrets](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
  work across every deployment in the project, even when a copy is stored in
  the branch-restricted GitHub `Staging` environment. Keep a separately labeled
  staging CI secret and a distinct labeled secret selected as Vercel's default
  `VERCEL_AUTOMATION_BYPASS_SECRET` system environment variable. To rotate them,
  create replacements, update the affected GitHub environment secrets and
  Vercel default, then push a fresh staging SHA. Verify its exact-SHA workflow
  and candidate/stable URLs with the replacements before revoking old secrets.
  Redeploy other consumers of the Vercel system default before revocation:
  Vercel snapshots that value when each deployment is built.
- On the staging Convex deployment, configure `AUTH_GITHUB_ID`,
  `AUTH_GITHUB_SECRET`, `JWT_PRIVATE_KEY`, `JWKS`, and
  `CLAWHUB_STAGING_EDGE_SECRET` for staging identity. The workflow checks the
  names without printing their values. It stamps
  `CLAWHUB_ENV=staging`, `CLAWHUB_DISABLE_CRONS=1`, both external-skill rollout
  modes to `off`, and `SITE_URL` before deploying.

The deploy order is: Convex deploy and contract check, stamp and read back
`APP_BUILD_SHA`, trigger the branch Deploy Hook, then wait for Vercel's commit
status and Preview deployment for that exact SHA after the hook request. The
workflow obtains the immutable Preview URL from the GitHub deployment, smokes
its API and UI, and then checks the stable branch/custom URL. The API smoke
requires staging backend and frontend SHA headers, and works with an empty
staging database. No Test backend or fixture seed is involved.

### Staging scan and publish workers

`SECURITY_SCAN_WORKER_TOKEN` must match between `cheery-civet-733` and the
GitHub `Staging` environment. Generate a separate random value for staging;
never reuse the production worker token. Workers use the repository's existing
OpenAI credential, supplied only to the scanner steps.

Both `prepublication-publish-checks.yml` and `security-scan-codex.yml` support
manual runs with `--ref staging`. They select the `Staging` environment, pin
`CONVEX_URL` to `cheery-civet-733`, and check that the deployed backend SHA
matches the workflow SHA before claiming work. Staging concurrency groups are
separate from production; staging security scans use one shared and one priority
worker instead of the production pool.

For automatic dispatch, configure the existing GitHub App integration on staging
(`GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`), then set
`SECURITY_SCAN_EVENT_DISPATCH_ENABLED=1` and
`CLAWHUB_STAGED_PREPUBLICATION_PUBLISHES=1`. Keep `CLAWHUB_DISABLE_CRONS=1`; upload
and queue events start workers through Convex's existing scheduled actions.
Staging dispatch payloads carry `environment: staging`. The workflows on `main`
relay these events to the same workflow on `staging`, using only a job-scoped
Actions token. They skip their production worker jobs for these events. The
GitHub App continues to require only its existing Contents write permission.

**Land the relay workflows on `main` before enabling staging event dispatch.**
GitHub receives repository dispatch events on the default branch. Before the
relay is available, verify workers with manual staging workflow runs.

### Skill Card lease capacity

Skill Card jobs own one of 64 capacity slots while running. Discovery runs in a
separate query; admission rereads the selected jobs, version leases, and slots
transactionally. Expiry, failure, completion, and aborted hydration release or
fence the same lease. Workers keep the existing array response and stop on
ambiguous transport errors; a partial batch does not imply an empty queue.

One action makes at most 64 discovery/admission pairs (128 internal query/mutation calls).
Only explicit zero-lease contention can replan; the first committed batch is
final. Exhaustion raises `SKILL_CARD_CLAIM_CONTENDED` instead of reporting an
empty queue. Competing claimers can still produce OCC retries; the slot index
removes unrelated numeric-slot completions from the capacity read set.

The optional `claimSlot` field needs no data backfill. Existing unslotted leases
remain counted during forward deployment. Keep this compatibility until all
pre-deployment writers and their unslotted leases are gone. An old action already
in progress can fail its next internal call when the admission arguments change;
it must not retry an ambiguous claim. Verify a fresh scheduled worker after
deployment.

Deploy the field, `by_status_and_claim_slot` index, and functions together with
the ordinary backend workflow. [Convex completes index backfill before activating
the new functions](https://docs.convex.dev/database/reading-data/indexes), so an
unknown historical table size affects deployment duration, not index readiness.
The deployment job has a 45-minute limit. If an operator chooses staged
backfilling for a large table, deploy only the optional field and staged index
first; wait for completion before enabling the index and these functions.

Runtime rollback must retain slot-aware admission and every slot-release path,
plus the optional field and index. Old writers can preserve a stale slot on a
queued row and later admit it into an occupied slot, breaking the global cap.
Restoring the old runtime requires a separately qualified pause of all writers,
lease settlement, removal and verification of every slot field, then the old
functions and schema. Draining active jobs alone is insufficient.
After backend deployment, verify the exact deployed SHA and a fresh Skill Card
worker run. Compare terminal claim failures separately from successful job counts.

Skill Card input reuse adds optional receipts to existing versions and jobs; no
backfill is required. The worker currently omits the recipe hash, so automatic
workflow runs remain compatible with the backend before its manual deployment.
Sol/medium/fast is enabled; input reuse is prepared but not active.

Activate recipe-hash claims in the separate worker change only after a successful
Convex deployment of the preparation commit or a descendant containing it. Verify
the actual schema/function deployment step; `appMeta:getDeploymentInfo` alone is
insufficient because the workflow stamps `APP_BUILD_SHA` before deployment.
Existing workflow checkouts can omit the hash for their remaining leases (up to
60 minutes). They still generate cards, but their completion clears any reusable
receipt because their recipe is unknown. Activated workers certify reuse only
after a successful generation with the current semantic inputs. Deploying source
does not itself prove the configured model is available to worker credentials.

Before changing the worker model, dispatch `Skill Card Worker` at the candidate
ref with `fixture-only=true`. This generates one benign card with the Production
OpenAI credential and the real renderer. It does not receive Convex credentials
or claim production jobs; the regular drain shards are excluded from that run.

## CLI npm release

The `clawhub` CLI package is released separately from the app deploy.
Only stable releases are supported here: `vX.Y.Z`.

Use the GitHub Actions workflow:

```bash
gh workflow run clawhub-cli-npm-release.yml \
  --repo openclaw/clawhub \
  --ref main \
  -f tag=v0.11.0 \
  -f preflight_only=true
```

Then rerun the same workflow from `main` with:

- the same `tag`
- `preflight_only=false`
- `preflight_run_id=<successful preflight run id>`

CLI release notes:

- Real publishes are manual-only and require the workflow to be started from `main`.
- The publish job waits at the GitHub `npm-release` environment for approval.
- npm auth is handled through npm trusted publishing, not an `NPM_TOKEN`.
- npm trusted publisher must be configured for package `clawhub` with repository `openclaw/clawhub`, workflow `clawhub-cli-npm-release.yml`, and environment `npm-release`.
- After a successful npm publish, the workflow creates or updates the matching GitHub Release from the `CHANGELOG.md` section and appends npm tarball/integrity proof.

If npm publish succeeds but GitHub Release creation needs repair, rerun the
GitHub Release workflow without publishing to npm again:

```bash
gh workflow run clawhub-cli-github-release.yml \
  --repo openclaw/clawhub \
  --ref main \
  -f tag=v0.11.0 \
  -f preflight_run_id=<successful preflight run id> \
  -f update_existing=false
```

If the original publish workflow failed after npm publish while creating the
GitHub Release, omit `publish_run_id`; the repair workflow accepts only
successful proof run ids.

Use `update_existing=true` only when intentionally replacing the body for an
existing GitHub Release.

That workflow assumes Vercel Git integration is enabled for this repo. It does
not run `vercel deploy` directly; frontend-related steps wait for the GitHub
commit status `Vercel - clawhub` for the selected SHA, then run smoke tests
against production.

Ensure Convex env is set (auth + embeddings):

- `AUTH_GITHUB_ID`
- `AUTH_GITHUB_SECRET`
- `CONVEX_SITE_URL`
- `JWT_PRIVATE_KEY`
- `JWKS`
- `OPENAI_API_KEY`
- `RESEND_API_KEY` for account-ban notification email
- `CLAWHUB_SECURITY_EMAIL_FROM` for the outbound From header, defaulting to
  `ClawHub Security <noreply@notifications.openclaw.ai>` on the verified Resend
  domain
- `CLAWHUB_NOREPLY_FROM` for guarded staff emails, defaulting to
  `ClawHub <noreply@notifications.openclaw.ai>` on the verified Resend domain
- `SITE_URL` (your web app URL)
- Optional webhook env (see `docs/webhook.md`)
- Recommended GitHub App env for authenticated GitHub API reads used by publish
  gates:
  - `GITHUB_APP_ID`
  - `GITHUB_APP_INSTALLATION_ID`
  - `GITHUB_APP_PRIVATE_KEY`
- Optional fallback: `GITHUB_TOKEN` (used when GitHub App auth is unavailable,
  and for arbitrary public repository lookups such as trusted-publisher setup)

Hosted anonymous API requests require the ClawHub Vercel proxy. It attaches
its OIDC service identity and replaces the visitor IP header with the Vercel
controlled address. Convex verifies the project and environment before using
that address for rate limits or download metrics. `TRUST_FORWARDED_IPS` no
longer enables raw forwarded headers.

Deploy the updated proxy before enabling backend enforcement. Set `SITE_URL`
to the public HTTPS frontend origin so direct anonymous Convex requests can
redirect there without consuming a shared quota. Invalid edge assertions return
401 without redirecting, so a broken edge identity cannot cause a loop. Verify
both anonymous API reads and downloads through that origin, as well as authenticated direct API
requests. The existing ClawHub Vercel OIDC identity must be available in both
Test and Production; this introduces no additional shared secret.

## 2) Deploy web app (Vercel)

Set env vars:

- `VITE_CONVEX_URL`
- `VITE_CONVEX_SITE_URL` (Convex "site" URL)
- `CONVEX_SITE_URL` (same value; used by auth provider config)
- `SITE_URL` (web app URL)
- `VITE_APP_BUILD_SHA` (set to the same commit SHA stamped into Convex)
- `VITE_KRILLSWITCH_EVAL_KEY` (optional public Krill Switch environment key;
  code defaults are used when absent)
- `VITE_KRILLSWITCH_BASE_URL` (optional; defaults to
  `https://flags.openclaw.ai`)

Deploy order:

1. Convex
2. contract verify
3. wait for Vercel production deploy for the same Git SHA
4. smoke

### Disposable PR previews

Vercel Preview builds use `bun run build:vercel`. The build entrypoint requires a
Convex Preview deploy key, recreates the branch's Convex preview with
`--preview-create`, builds the frontend with that deployment's URL, and runs the
same `bun run seed` pipeline used by local development against that preview name.

One-time setup:

1. In the Convex project settings, generate a Preview deploy key.
2. In the Vercel project, set `CONVEX_DEPLOY_KEY` to that key for the **Preview**
   environment only.
3. In the Convex project default environment variables for Preview deployments,
   set:
   - `CLAWHUB_PREVIEW=1`
   - `CLAWHUB_DISABLE_CRONS=1`
4. Do not copy production auth, email, webhook, scanner, worker, backup, or
   user-channel secrets into Preview defaults.
5. Remove `CONVEX_DEPLOY_KEY` from the Vercel **Production** environment if it
   exists. Production Convex deploys remain manual-only through
   `.github/workflows/deploy.yml`.

The shared seed command fails closed unless its target is local or an explicit
preview name selected with a Convex Preview deploy key. It installs
the committed public corpus plus the same synthetic clean, suspicious, and
malicious presentation states used locally. Permanent Test remains
snapshot-backed. The separate Staging deployment and production are never
seeded by Preview builds.

### Permanent Test plugin pre-publication scans

Test plugin uploads can run the same pre-publication scanners as production
without enabling Test's general Convex crons. Configure
`PREPUBLICATION_PUBLISH_EVENT_DISPATCH_ENABLED=1` and the GitHub App dispatch
credentials on `academic-chihuahua-392`. The `Test` GitHub Actions environment's
Convex deploy key is used to load that deployment's `SECURITY_SCAN_WORKER_TOKEN`
inside the pre-publication worker process; do not copy the Test worker token to
Production or the repository-wide GitHub secret.

The Convex upload dispatch marks its event with `environment=test`. A secretless
repository-dispatch relay then starts the pre-publication worker from `main`
with the GitHub `Test` environment and a target guard pinned to
`academic-chihuahua-392`. The worker checks the exact pending upload attempt.
Test crons remain disabled, so this does not scan the catalog on a nightly or
periodic schedule. The five-minute scheduled pre-publication worker remains a
Production-only recovery path.

Preview browser traffic is public and read-only. Nitro rejects non-GET/HEAD
requests before proxying and adds `X-ClawHub-Preview-Backend` to proxied preview
responses so smoke proof can record the paired non-secret deployment name.
Authenticated write flows belong in the permanent test environment.

## 3) Route `/api/*` to Convex

Nitro handles `/api/**` and `/v1/feeds/**` through the environment-aware Convex
proxy in `server/convexProxy.ts`. The target comes from the build's
`VITE_CONVEX_SITE_URL`, or is derived from the paired `VITE_CONVEX_URL`. Those
build-time values are compiled into the Nitro server output so stale Vercel
runtime variables cannot redirect a Preview deployment to production.

Do not add a production deployment hostname back to `vercel.json`. Static
rewrites would make Vercel previews query production even when their Convex
client points at a disposable backend.

For self-hosting, set `VITE_CONVEX_URL` and optionally
`VITE_CONVEX_SITE_URL` to the intended deployment before building.

## 4) Registry discovery

The CLI can discover the API base from:

1. explicit CLI/env override
2. configured registry URL
3. site URL registry metadata

Keep production rewrites and discovery metadata aligned before release.

### Hosted feeds

Refresh the OpenClaw hosted plugin and skill feeds after the production Convex
deployment has the catalog projections:

```bash
gh workflow run publish-catalog-feed.yml --repo openclaw/clawhub --ref main
```

The workflow stores both current feed snapshots in Convex and serves them
through `/v1/feeds/plugins` and `/v1/feeds/skills` with public edge-cache
validators. The unversioned `/feeds/plugins` and `/feeds/skills` paths redirect
to their versioned routes. Attach `registry.openclaw.ai` to the same Vercel
project before configuring OpenClaw's default feed URLs.

Production backend deploys publish an initial promotions snapshot after Convex
deploys. Active promotion changes then refresh the stored snapshot immediately,
schedule refreshes at launch and expiry boundaries, and use a six-hour cron as
an expiry backstop. The feed is served through `/v1/feeds/promotions`, with
`/feeds/promotions` redirecting to the versioned route.

## 5) Post-deploy checks

Run the contract verifier and smoke tests against production after deploy:

```bash
bun run verify:convex-contract -- --prod
PLAYWRIGHT_BASE_URL=https://clawhub.ai bunx playwright test e2e/menu-smoke.pw.test.ts e2e/upload-auth-smoke.pw.test.ts
```
