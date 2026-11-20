---
title: "Repairing published Template artwork"
summary: "Preview, apply, verify, or undo a single historical Template artwork repair"
read_when:
  - Operating an approved repair of missing catalog artwork on published Templates
llms: false
---

# Repairing published Template artwork

This internal operator repairs artwork **one release at a time**. Nothing self-schedules.
A historical release updates only its version icon. The current release also fills
missing icon fields on the package, its existing latest-version summary, search
digest, and topic listings. Existing artwork is never replaced. It does not edit
archives, publish a version, change timestamps or tags, or reclassify a listing.

Deploy the matching publish path and maintenance functions through the normal release
process first. Rehearse on an isolated deployment. Confirm the production target
(`wry-manatee-359`) and deployed revision before any production call; use a maintenance
window without overlapping deployments. Start in the matching ClawHub checkout. The
examples use Bash and jq, with a private working directory for receipts outside Git.

## Preview and apply

1. List candidate packages (at most ten small results). This does not scan a package's releases.

   ```bash
   REPO=$(git rev-parse --show-toplevel)
   mkdir -p "$HOME/.clawhub-maintenance"
   cd "$(mktemp -d "$HOME/.clawhub-maintenance/template-artwork.XXXXXX")"
   DEPLOYMENT=wry-manatee-359 # use the verified test deployment name for rehearsal
   run() { (cd "$REPO" && bunx convex run --deployment "$DEPLOYMENT" "maintenance:$1" "$2"); }
   run listTemplateArtworkPackagesInternal '{}' > packages.json
   jq . packages.json
   ```

   If `isDone` is false, the next list argument is `$(jq -c '{cursor}' packages.json)`. Do not discard
   packages whose current version has an icon: a prior public version may still need one.

2. Pick a returned package ID. Start its **release** cursor at null, not the package-list cursor.
   Keep the **input** for each page alongside its preview, using distinct filenames or
   directories. Each call inspects at most one release and never mutates in preview mode.

   ```bash
   PACKAGE_ID='replace-with-returned-packageId'
   jq -n --arg id "$PACKAGE_ID" '{packageId:$id,cursor:null}' > page.json
   run repairTemplateArtworkInternal "$(cat page.json)" > preview.json
   jq . preview.json
   ```

   `would-repair` contains the exact release ID, guarded state hash, and proposed hosted
   icon under `approval`. Review these before asking for approval to write. `unchanged`
   needs no operation. `ineligible` includes pending, withdrawn, blocked, private, and
   non-Template rows. `no-eligible-artwork` means neither the packaged PNG nor the declared
   avatar could be safely used. Do not substitute a guessed path or remote URL.
   Investigate `drifted` or `existing-artwork-conflict` rather than forcing a result.

3. **After explicit approval**, apply only that reviewed page. Keep the returned `receiptId`.

   ```bash
   APPLY=$(jq -e -s 'select(.[1].status == "would-repair") | .[0] +
     {dryRun:false,confirm:"repair-template-artwork",approval:.[1].approval}' page.json preview.json) &&
     run repairTemplateArtworkInternal "$APPLY" > applied.json
   jq . applied.json
   ```

   The mutation rechecks owner, release, latest pointer, artifact inventory, public eligibility,
   and icon/projection state. No package metadata is written if stale. A content-addressed
   PNG can already be registered if an action loses a race before that commit; it is safe to
   share and is not evidence of a completed repair. If the response is lost, **do not reapply**:
   use the release ID to look up the atomic receipt, then compare its `beforeHash` and `icon`
   with the preview's `stateHash` and `icon`.

   ```bash
   run getTemplateArtworkReceiptInternal "$(jq '{releaseId:.approval.releaseId}' preview.json)"
   run repairTemplateArtworkInternal "$(cat page.json)"  # now unchanged
   ```

4. If the preview's `isDone` is false, use **its output cursor** for the next release of
   this package. Keep each page separate; never reuse one release's approval on another.
   For example: `jq -s '.[0] + {cursor:.[1].cursor}' page.json preview.json > next-page.json`.
   Repeat each package's scan from null for verification. Record unchanged, approved repairs,
   unsupported inputs and any conflicts separately. Pause between calls if load increases.

## Rollback and feed verification

Preview a rollback by receipt ID. A changed owner, release, latest pointer, icon, facet, or
superseding receipt prevents reversal. There is no force option. After reviewing the preview
and obtaining rollback approval, use the same receipt ID:

```bash
RECEIPT=$(jq -ec 'select(.status=="repaired") | {receiptId}' applied.json)
run rollbackTemplateArtworkInternal "$RECEIPT" # expect would-rollback
run rollbackTemplateArtworkInternal "$(jq '. + {dryRun:false,confirm:"rollback-template-artwork"}' <<< "$RECEIPT")"
run rollbackTemplateArtworkInternal "$RECEIPT" # expect already-rolled-back
```

Rollback restores only the changed icon references, including previously missing projection
icons. It does not delete shared content-addressed blobs. Check the version endpoint
(`/api/v1/packages/<encoded-name>/versions/<version>`), the Template listing, and the PNG
response after apply or rollback. Archive SHA-256 and release version must be unchanged.

The Official Template feed is a **stored snapshot**, not a live query. For an affected
eligible `@openclaw` latest release, capture the current feed, then wait for the next
six-hour refresh, or use the normal production publication workflow after approval:

```bash
curl -fsS https://clawhub.ai/api/v1/feeds/templates > feed-before.json
gh workflow run publish-catalog-feed.yml --repo openclaw/clawhub --ref main -f expires_in_days=7
# After that exact workflow run succeeds:
curl -fsS -D feed-headers.txt https://clawhub.ai/api/v1/feeds/templates > feed-after.json
jq '{sequence,generatedAt}' feed-before.json feed-after.json
jq --arg name '@openclaw/replace-me' '.entries[] | select(.id==$name) | {id,version,icon,install}' feed-after.json
shasum -a 256 feed-after.json  # must match the sha256 in the response ETag
```

Verify the sequence advanced, the expected absolute icon URL (or prior value on rollback)
is present, and the exact-version install integrity is unchanged. Community releases do not
enter this feed. **This workflow produces a checksummed, unsigned snapshot**: the ETag and
artifact digests are not signatures. There is no Template feed signing key or signing step
in this repository. If a consumer requires a signed envelope, stop and involve its signing
operator; do not edit the stored payload, invent a signature, or weaken client trust.

The operator reads only the unique archive `package.json` (256 KiB) and its selected manifest
(1 MiB), verifies stored and actual bytes, and rejects invalid UTF-8. It uses the same restricted
Markdown frontmatter parser and avatar renderer as publication. Only this historical read
also accepts the retired `openclaw.claw` selector or a declared JSON manifest; mixed selectors
are ambiguous and skipped. No legacy selector is re-enabled for new publications. Keep the
operator until rollback is no longer needed; removal is a separate approved change.
