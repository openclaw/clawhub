# Curated company plugins

This importer inventories registry entries but publishes only reviewed source entries. It reuses ClawHub's ordinary package publisher, immutable releases, GitHub folder hashing, prepublication workers, catalog and download API. It does not maintain upstream forks or contact authors.

## Review an initial batch

1. Run `bun run plugins:inventory --help` and inventory the configured registry snapshots and current ClawHub catalog. Review every winner and exclusion in the JSON report, including the informational permission-needed list.
2. For each accepted `(integration, job)`, verify repository and owner IDs against the company's own evidence. Review the exact repository path, MIT source closure, preserved notices, supported format, omitted components and controlled categories. Record known bundled/published OpenClaw equivalents in `openclaw`; these suppress imports and report catalog parity gaps.
3. Use the existing publisher workflow to create an organization owned by staff. For company sources, record custody with `curatedPlugins:setStaffCustodyInternal` using the active admin, publisher ID, exact `sourceRepo`, GitHub owner ID and HTTPS ownership evidence. This fails for company-owned or already verified publishers. Registry copies require the existing `cursor`, `anthropic` or `openai` organization and retain registry authorship. Official status uses the existing separately reviewed publisher policy.
4. Authenticate the normal ClawHub CLI as staff, or inject `CLAWHUB_TOKEN` through the execution environment. Generate a plan:

   ```sh
   bun run plugins:sync --manifest scripts/company-plugins/sources.json --registry https://clawhub.ai --output /tmp/company-plugin-plan.json
   ```

5. Review the plan's exact source commits, source hashes, artifact file hashes, target versions and canonical replacements. Apply only that digest:

   ```sh
   bun run plugins:sync --manifest scripts/company-plugins/sources.json --registry https://clawhub.ai --output /tmp/company-plugin-result.json --apply --approved-digest <reviewed-digest>
   ```

   Changed upstream state requires another review. Publication remains private until the ordinary secret scan, ClawScan and compatibility checks clear. Inspect the resulting catalog and downloads before considering the batch complete.

## Scheduled updates

The workflow is disabled until `COMPANY_PLUGIN_SYNC_ENABLED=true` is configured. It runs only on `main` in the Production environment and requires a staff CLI token in the `CLAWHUB_COMPANY_PLUGIN_TOKEN` environment secret. Do not put tokens in manifests, command arguments or reports. Configure activation only after maintainer acceptance of the implementation and initial batch.

An entry needs `approved: true` and the reviewed `approvedInitialHash` to participate. First publication must match that initial hash. Subsequent updates verify the same repository, owner, path, format, integration, job and authorship, then repeat licensing, capability extraction and the normal publication security gates. Transferring the publisher through the existing verified GitHub organization adoption flow stops staff synchronization.

Unchanged source hashes do not create releases, even after removal and reappearance. New bytes preserve an unused upstream version; reuse of an upstream version receives a `+clawhub.<source-hash>` suffix. Existing releases are never overwritten. A historical upstream rollback requires a reviewed promotion instead of an automatic downgrade. Pending or blocked artifacts remain withheld. A failed update leaves the previous safe release available.

Missing repositories, removed paths, permission changes and incompatible source updates appear in the report; synchronization retains the last safe immutable release rather than deleting a published package. Fetch or state-request failures preserve the report and stop the entire apply before any artifact is submitted. GitHub retains the report artifact for 30 days.

## Canonical replacement

For a newly available company source, review `supersedes: ["@registry/integration-job"]` on that company entry. The old and new releases must have the same integration and job. Once the company artifact clears scans, one transaction publishes it, removes the registry result from public discovery and records a canonical redirect. Unversioned API links resolve to the company package; pinned version downloads retain the original bytes and provenance. A pending update on an already replaced package cannot finish publication.

For an already-published clean company target, staff can make the same reviewed decision through `curatedPlugins:setCanonicalReplacementInternal`, with `actorUserId`, `name`, `targetName` and a reason. Replacement is audited and idempotent. Conflicting prior decisions need separate review; the importer does not silently rewire them.

## Local acceptance proof

Run `bun run test:pw:local-auth -- e2e/local-auth/company-plugin-sync.pw.test.ts --project=chromium`. Set `COMPANY_PLUGIN_PROOF_OCM_ENV` to an existing disposable OCM environment to also install selected artifacts through the real OpenClaw `clawhub:` installer. The fixture uses controlled scan verdicts through the real worker protocol, not live-provider certification. Its attached catalog JSON, package archives, screenshots and installation output are the review evidence.
