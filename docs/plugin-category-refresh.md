---
title: "Refreshing plugin categories"
summary: "Operate the reviewed production plugin category refresh and rollback workflow"
read_when:
  - You are operating an approved production plugin category backfill
llms: false
---

# Refreshing plugin categories

The **Plugin Category Refresh** GitHub workflow operates on production
`wry-manatee-359` using the existing Production environment credential. It never
deploys code. First deploy the matching frontend and backend from main through
the normal release workflow. Every operation verifies the exact deployed commit
and public category vocabulary before proceeding.

Keep production deployments frozen for the whole refresh window. The SHA check
is a preflight, not a global deployment lock. Apply starts an asynchronous
migration: wait until status reports completion before allowing any deployment,
and recheck status if an operation loses its response. The backend separately
rechecks each row's classifier, pinned bundled assignment, latest release, and
source hash. The operator should verify the deployed SHA around each wave.

## Preview and review

Use a stable run ID for a complete traversal. A preview writes journal rows and
may call `gpt-5.6-luna`; it does not change the categories people browse. The
production `OPENAI_API_KEY` must exist and `OPENAI_PLUGIN_CATEGORY_MODEL` must be
unset or `gpt-5.6-luna`. Status reports these checks as booleans, without secrets.

```bash
gh workflow run plugin-category-refresh.yml --repo openclaw/clawhub --ref main \
  -f mode=status -f expected_sha="$DEPLOYED_SHA" -f run_id="$CATEGORY_RUN"

gh workflow run plugin-category-refresh.yml --repo openclaw/clawhub --ref main \
  -f mode=preview -f expected_sha="$DEPLOYED_SHA" -f run_id="$CATEGORY_RUN" \
  -f max_pages=20 -f workers=3 -f cursor="$PREVIEW_CURSOR"
```

Each preview handles at most twenty pages of ten package rows, with at most four
simultaneous actions. Pages can contain no plugins. Download the workflow's
`plugin-category-refresh-*` artifact and use its `resumeCursor` for the next
dispatch. On failure, that cursor stops before the first incomplete page, even
if later pages completed. Reuse the same run ID: existing journal rows are
skipped, never replaced. A request that lost its response might still finish on
the server; wait for it to settle before retrying. Run one final traversal from
the beginning with the same run ID to reconcile changes during enumeration.
Each page preserves bounded package IDs and diagnostic reasons for skipped or
failed entries, including entries that never produced a journal row.

Run `mode=report` with `cursor`/`max_pages` to export up to 2,000 journal rows per
dispatch. Report cursors and preview cursors belong to different tables; do not
interchange them. Inspect proposed categories, source, evidence, previous
categories, version, and status. Fallback rows cannot be accepted; retry failed
classifications under a new run ID. Existing author declarations, including
valid legacy arrays, remain authoritative.

Choose at most 100 rows for a wave, starting with a small pilot. Use `report`
with the JSON `reviewed_ids` array to get the exact selected rows and their
`reviewHash`. The hash binds the release, source hash, classification, and
category assignment. It intentionally excludes mutable journal status so it
remains valid as that assignment moves from preview to accepted to applied.

```bash
gh workflow run plugin-category-refresh.yml --repo openclaw/clawhub --ref main \
  -f mode=report -f expected_sha="$DEPLOYED_SHA" -f run_id="$CATEGORY_RUN" \
  -f reviewed_ids="$REVIEWED_IDS_JSON"

gh workflow run plugin-category-refresh.yml --repo openclaw/clawhub --ref main \
  -f mode=accept -f expected_sha="$DEPLOYED_SHA" -f run_id="$CATEGORY_RUN" \
  -f reviewed_ids="$REVIEWED_IDS_JSON" -f review_hash="$REVIEW_HASH"
```

Accept marks reviewed rows accepted and rehearses the first ten through a
transaction that rolls back. Category state stays unchanged. A failed rehearsal
leaves accepted rows available for inspection. Fresh generated previews must use
classifier `plugin-single-category-v3`; bundled previews must match the pinned
OpenClaw source commit and manifest hashes in the checked-out inventory.

## Apply, monitor, and undo

Dispatch `mode=apply` with the same reviewed IDs and hash after a successful
rehearsal. Apply repeats the first-ten rehearsal and verifies how many rows it
processed, so a previous failed or lost rehearsal response cannot bypass this
gate. The workflow requires every selected row to be accepted and refuses
to start while another migration worker runs or any unreviewed accepted row
exists. The shared migration worker applies batches of ten. Its accepted-row
index covers all runs, so use this workflow as the sole operator during a wave.

Poll `mode=status`, then export `mode=report`. The component's processed count
includes attempts; count actual `applied` and `stale` journal rows separately.
The backend checks the latest release and evidence again when applying; changed
rows become stale instead of overwriting newer work. Wait for the worker to
finish and verify browse/detail output before starting another wave.

If a wave stops partway through, report and select only its remaining accepted
rows, obtain their new review hash, and dispatch apply again. The workflow
restarts the accepted index only when no worker is active. For rollback, report
and select applied rows, then dispatch `mode=rollback` with those IDs and hash.
Rollback refuses when a newer publication or category edit changed the applied
state. After a partial rollback failure, report and select only the remaining
applied rows before retrying. Keep the journal and downloaded artifacts until
verification is complete; artifacts expire after thirty days.
