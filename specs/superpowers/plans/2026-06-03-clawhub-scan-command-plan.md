# ClawHub Scan Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build authenticated `clawhub scan` submit-and-poll support for ephemeral local skill scans and owner/operator published skill rescans.

**Architecture:** Add a persisted scan-request record that can target either uploaded ephemeral files or a published skill version, then enqueue the existing `securityScanJobs` worker against that record. The public CLI submits a scan, polls the status route until terminal, renders the full security report, and optionally downloads the canonical report ZIP.

**Tech Stack:** Convex HTTP actions/mutations, existing ClawScan worker queue, `@clawhub/schema` route/schemas, Bun/Commander CLI packages, Vitest.

---

## File Map

- `convex/schema.ts`: add `skillScanRequests` and extend `securityScanJobs` with `skillScanRequestId`.
- `convex/securityScan.ts`: create/poll/download scan requests and hydrate/complete/fail worker jobs for scan-request targets.
- `convex/httpApiV1/skillsV1.ts`: add canonical `/api/v1/skills/-/scan` submit/poll/download/batch handlers and keep legacy rescan aliases.
- `convex/httpApiV1/shared.ts`: add multipart parsing helper for scan upload files if the publish parser is too specific.
- `convex/http.ts`: register scan routes before generic `/api/v1/skills/*` routes.
- `packages/schema/src/routes.ts` and `packages/schema/src/schemas.ts`: add route constants and request/response schemas.
- `packages/clawhub/src/schema/routes.ts` and `packages/clawhub/src/schema/schemas.ts`: update vendored schema copies used by the published CLI package.
- `packages/clawhub/src/cli.ts`: register the new top-level `scan` command.
- `packages/clawhub/src/cli/commands/scan.ts`: implement scan source validation, submit, poll, terminal report, JSON output, and ZIP download.
- `packages/clawhub/src/cli/commands/scan.test.ts`: cover CLI source validation, request shape, polling, and `--output`.
- `packages/clawhub-admin/src/commands/moderation.ts`: route single and batch rescans through canonical scan endpoints.
- `packages/clawhub-admin/src/commands/moderation.test.ts`: prove moderator commands use canonical scan routes.
- `docs/cli.md`, `docs/http-api.md`, and `specs/security-moderation.md`: document the public command, API shape, and security invariants.

## Task 1: Shared Schema Contract

**Files:**

- Modify: `packages/schema/src/routes.ts`
- Modify: `packages/schema/src/schemas.ts`
- Modify: `packages/clawhub/src/schema/routes.ts`
- Modify: `packages/clawhub/src/schema/schemas.ts`
- Test: `packages/schema/src/schemas.test.ts` if present, otherwise `packages/clawhub/src/cli/commands/scan.test.ts` validates parsed shapes through CLI usage.

- [ ] **Step 1: Write the failing schema/CLI contract test**

Add a test that expects the CLI to submit:

```ts
{
  source: { kind: 'published', slug: 'demo', version: '1.2.3' },
  update: true,
}
```

to `POST /api/v1/skills/-/scan` and accept:

```ts
{
  scanId: 'scan_123',
  jobId: 'job_123',
  status: 'queued',
  sourceKind: 'published',
  update: true,
}
```

- [ ] **Step 2: Run the test to verify RED**

Run: `bun test packages/clawhub/src/cli/commands/scan.test.ts`

Expected: FAIL because the `scan` command and scan schemas do not exist yet.

- [ ] **Step 3: Add route constants**

Add `skillScans: '/api/v1/skills/-/scan'` to both route files.

- [ ] **Step 4: Add Zod schemas**

Add schemas for:

```ts
ApiV1SkillScanSourceSchema;
ApiV1SkillScanSubmitRequestSchema;
ApiV1SkillScanSubmitResponseSchema;
ApiV1SkillScanStatusResponseSchema;
ApiV1SkillScanDownloadManifestSchema;
ApiV1SkillScanBatchRequestSchema;
ApiV1SkillScanBatchResponseSchema;
ApiV1SkillScanBatchStatusRequestSchema;
ApiV1SkillScanBatchStatusResponseSchema;
```

Keep the batch schemas compatible with existing bulk rescan request/status shapes while renaming them to the scan route vocabulary.

- [ ] **Step 5: Run the targeted test**

Run: `bun test packages/clawhub/src/cli/commands/scan.test.ts`

Expected: still FAIL until the CLI command exists, but schema import failures should be gone.

## Task 2: Convex Scan Request Storage

**Files:**

- Modify: `convex/schema.ts`
- Modify: `convex/securityScan.ts`

- [ ] **Step 1: Add a focused failing backend test if an existing Convex test harness covers security scans**

Search with: `rg "securityScan|requestSkillRescan|bulk rescan" convex packages -g '*.test.ts'`

If a harness exists, add tests for local scans rejecting `update: true` and published scans requiring owner/operator permissions. If no harness exists, cover the behavior through HTTP/CLI tests and document the gap in the final handoff.

- [ ] **Step 2: Extend schema**

Add `skillScanRequests` with actor, source kind, optional slug/version/version ids, stored files, status, result fields, writeback flag, timestamps, and indexes by actor, job, and expiry.

Extend `securityScanTargetKindValidator` with `skillScanRequest` and add optional `skillScanRequestId` plus `by_skill_scan_request`.

- [ ] **Step 3: Add internal helpers**

Implement helpers in `convex/securityScan.ts` for creating uploaded scan requests, creating published scan requests, polling scan request status, and recording completed/failed results.

- [ ] **Step 4: Wire worker hydration**

Update `getJobTargetInternal` and `claimCodexScanJobs` so scan-request jobs hydrate the same `files` URL shape as skill-version jobs.

- [ ] **Step 5: Wire worker completion**

Update `completeCodexScanJob` and `failCodexScanJob` so scan-request jobs store results on the request. If `sourceKind === 'published' && update === true`, also write successful ClawScan results back through the existing skill-version update path.

## Task 3: HTTP Scan API

**Files:**

- Modify: `convex/httpApiV1/skillsV1.ts`
- Modify: `convex/httpApiV1/shared.ts`
- Modify: `convex/http.ts`

- [ ] **Step 1: Add failing HTTP route tests if an HTTP handler harness exists**

Search with: `rg "httpRouter|httpAction|api/v1/skills" convex packages -g '*.test.ts'`

Add tests for auth-required local submit, owner-only published submit, poll, and download ZIP entries when a harness exists.

- [ ] **Step 2: Implement multipart upload parsing**

Parse a `payload` JSON part plus `files[]` file parts. Store uploaded file blobs in Convex storage and pass path/size/hash/storage metadata into the internal create helper.

- [ ] **Step 3: Implement `POST /api/v1/skills/-/scan`**

Require token auth. For `source.kind === 'upload'`, reject `update: true`. For `source.kind === 'published'`, resolve slug/version and enforce owner/member/operator access before enqueueing.

- [ ] **Step 4: Implement `GET /api/v1/skills/-/scan/{scanId}`**

Require token auth. Return queued/running/succeeded/failed status, artifact identity, writeback status, and the full report payload when available.

- [ ] **Step 5: Implement `GET /api/v1/skills/-/scan/{scanId}/download`**

Require token auth. Return a ZIP with `manifest.json`, `clawscan.json`, `skillspector.json`, `static-analysis.json`, `virustotal.json`, and `README.md`.

- [ ] **Step 6: Move batch routes under the scan group**

Register `POST /api/v1/skills/-/scan/batch` and `POST /api/v1/skills/-/scan/batch/status`, then keep the old `/-/rescan-batch` routes as compatibility aliases.

## Task 4: Public CLI Command

**Files:**

- Create: `packages/clawhub/src/cli/commands/scan.ts`
- Create: `packages/clawhub/src/cli/commands/scan.test.ts`
- Modify: `packages/clawhub/src/cli.ts`

- [ ] **Step 1: Write failing CLI tests**

Test these behaviors:

```sh
clawhub scan fixtures/skill
clawhub scan --slug demo --version 1.2.3 --update
clawhub scan --slug demo --output report.zip
clawhub scan fixtures/skill --update
clawhub scan fixtures/skill --slug demo
```

Expected: the first three submit/poll correctly; the last two fail with clear validation errors.

- [ ] **Step 2: Implement local source validation**

Resolve `<path>`, require `SKILL.md` or `skill.md`, collect files with `listTextFiles`, and submit multipart using `apiRequestForm`.

- [ ] **Step 3: Implement published source submission**

Require `--slug`, optional `--version`, optional `--update`, and submit JSON to `ApiRoutes.skillScans`.

- [ ] **Step 4: Implement polling**

Poll `GET /api/v1/skills/-/scan/{scanId}` until `succeeded` or `failed`. Print progress unless `--json` is set.

- [ ] **Step 5: Implement terminal and JSON reports**

Render artifact metadata, ClawScan summary/findings/guidance, SkillSpector issues, static scan findings, VirusTotal counts, and update/writeback status. With `--json`, print the parsed status response.

- [ ] **Step 6: Implement `--output`**

Call `GET /api/v1/skills/-/scan/{scanId}/download` after terminal success and write the returned ZIP bytes to the requested file path.

## Task 5: Admin CLI Migration

**Files:**

- Modify: `packages/clawhub-admin/src/commands/moderation.ts`
- Modify: `packages/clawhub-admin/src/commands/moderation.test.ts`

- [ ] **Step 1: Update failing tests**

Expect `clawhub-admin skills rescan <slug>` to call `POST /api/v1/skills/-/scan` with published `update: true`.

Expect `clawhub-admin skills rescan-all` to call `POST /api/v1/skills/-/scan/batch` and poll `/api/v1/skills/-/scan/batch/status`.

- [ ] **Step 2: Update implementation**

Keep prompts and JSON output behavior. Change only the route contract and response parsing.

## Task 6: Docs, Specs, Verification

**Files:**

- Modify: `docs/cli.md`
- Modify: `docs/http-api.md`
- Modify: `specs/security-moderation.md`

- [ ] **Step 1: Document user-facing CLI**

Add examples for local ephemeral scans, published scans, `--update`, `--output`, and `--json`.

- [ ] **Step 2: Document HTTP API**

Add submit, poll, download, and batch scan routes. Mark legacy rescan routes as compatibility aliases where they remain.

- [ ] **Step 3: Document security invariant**

State that local uploaded scans are authenticated but ephemeral, never public-state mutations, and published update scans require owner/member/operator authority.

- [ ] **Step 4: Run verification**

Run targeted tests first:

```sh
bun test packages/clawhub/src/cli/commands/scan.test.ts
bun test packages/clawhub-admin/src/commands/moderation.test.ts
```

Then run broader package/type gates when targeted tests pass:

```sh
bun run ci:packages
bun run ci:static
```

If Convex schema or generated API changes require codegen, run:

```sh
bunx convex codegen
```

## Self-Review

- Spec coverage: covered local ephemeral scans, published read-only scans, explicit update scans, submit/poll behavior, report ZIP, moderator migration, docs, and legacy route compatibility.
- Placeholder scan: no `TBD`, `TODO`, `fill in`, or undefined future task references remain.
- Type consistency: this plan consistently uses `skillScanRequests`, `skillScanRequestId`, `source.kind`, `scanId`, `jobId`, `status`, and `update`.
