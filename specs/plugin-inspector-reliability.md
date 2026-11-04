# Plugin Inspector operational failures

## Plugin Inspector is advisory

Plugin Inspector never fails or blocks a publish. Over the 30 days before this
rule, the publish gate blocked 145 plugin publishes and only 4 were plugin
defects (declared entrypoints missing from the upload); the other 141 were the
tool failing: 512 MiB Node action OOMs, timeouts, or OpenClaw target
preparation errors. Those were reported to publishers as plugin breakage.

- Package validation owns the one real check. `validateOpenClawExternalCodePluginPackageContents`
  (clawhub-schema) rejects a code plugin whose `openclaw.extensions`,
  `openclaw.runtimeExtensions`, `openclaw.setupEntry`, or
  `openclaw.runtimeSetupEntry` entries are missing from the uploaded files. It
  mirrors OpenClaw's `validatePackageExtensionEntriesForInstall` for installed
  packages (no TypeScript source fallback): a declared runtime entry must exist;
  otherwise a TypeScript entry needs one of `listBuiltRuntimeEntryCandidates`,
  and a JavaScript entry must exist itself. Entries that resolve outside the
  package are rejected. The CLI runs the same function before upload, so the
  author sees the error locally. Undeclared entrypoints stay out of scope.
- Plugin Inspector does not run in the publish request. Once a plugin
  release is accepted (`finalizePackagePublishAttemptInternal` has published
  it and recorded the attempt finalized), the production deployment schedules
  `pluginInspectorDispatch:dispatchPluginInspectorReleaseScanInternal`, which
  sends the `clawhub-plugin-inspector-release-scan` repository_dispatch event.
  `plugin-inspector-bulk-scan.yml` runs a targeted, persisted, email-free scan
  of that package (`PLUGIN_INSPECTOR_PACKAGE_NAMES`). The nightly sweep covers
  any release whose dispatch failed or was skipped. Dispatch reuses the
  deployment's `SECURITY_SCAN_EVENT_DISPATCH_ENABLED` switch and GitHub App
  credentials, and only the production deployment dispatches because the
  workflow scans the production site. Release scans queue per package; the
  nightly run keeps its own concurrency group and lease.
- Targeted scans inspect the package's latest public release, so only the
  latest public plugin release dispatches. Monitoring has no publish-time
  budget: it runs on a GitHub runner, not the 512 MiB Convex Node action,
  with a 30-minute job timeout for release scans.
- Inspector results carry an outcome: `clean`, `findings`, `tool_failure`, or
  `timeout`. Failures carry `{ stage, reason, message }` with reason
  `out_of_memory`, `target_unavailable`, `timeout`, or `error`. A tool failure
  never becomes a finding, an email, or a publish error.
- Outcomes are recorded on `packageInspectorScanStates` (`outcome`, `failure`,
  `scanSource`). Rows written before outcomes existed have no `outcome` and
  are completed scans; a pre-outcome bulk-scan failure therefore still reads
  as a completed scan until the next scan of that identity rewrites it.
  Attempts staged while Inspector still ran at publish (before this cutover,
  within the 30-day attempt TTL) still apply their staged findings and outcome
  at finalization with `scanSource: "publish"`, never emailing owners; a
  publish-time failure without a resolved target used
  `targetOpenClawVersion: "unresolved"`, which matches no real target.
- A failed rescan never replaces a completed verdict for the same release,
  Inspector version, and target: the row keeps its `outcome`, `completedAt`,
  and findings and records only the latest `failure`. A later completed scan
  clears `failure`.
- A failed or timed-out scan state never counts as covering a release: the
  bulk scan claim does not skip it, and the plugin validation report takes its
  verdict and nightly finding tuple from the latest scan that actually
  inspected the release. A release with only failed scans reports
  `status: "skipped"` with `skipReason` `inspector-timeout` or
  `inspector-tool-failure`, never `error`.
- Owner email stays with reviewed notification runs of the bulk scan;
  release scans never notify.

The earlier publish-time design (a 512 MiB Convex Node action, a ClawHub
prepared OpenClaw `latest` target cache, and a 120 s caller budget) is retired.
Its history matters for one rule: anything heavy that inspects plugin packages
belongs outside the Convex publish request.

## Bulk scan and logging

The bulk scan prepares its OpenClaw target with the dependency's
`openClawTargets.prepare` on the GitHub runner, owns one disposable workspace
per release, and removes it after each scan. Logs contain package identity and
fixed stage names, never credentials, file contents, or scratch paths.

The static publish scan runs in its own Node action and must import only leaf
modules. Loading the `clawhub-schema` barrel (ArkType schemas) costs about
150 MB RSS before any file is read; with the whatsapp 2026.9.7 ClawPack (1,655
files, 22 MB) that measured 390 MB peak locally versus 252 MB with the
`clawhub-schema/textFiles` import, and the production action hit 512 MiB.

Artifact SDK usage inventories are owned by the bulk scan. Inspector 0.4.1+
builds that inventory as a TypeScript program over every packed file; with
Inspector 0.4.3 against OpenClaw 2026.10.5 it measured 783 MB to 1,003 MB max
RSS for the discord, matrix, and whatsapp ClawPacks, which is why it never ran
inside Convex. A new release reports `missing` until its scan completes.
Attempts staged before inventories left publication still apply their stored
inventory at finalization until the 30-day attempt TTL expires.

Isolated successful retries establish recovery only, not a concurrency,
capacity, or memory root cause. On recurrence, retain the stage/request id and
obtain backend disk/inode and executor diagnostics before changing resource
limits or retry policy.

Browser warning fixtures use missing manifest display metadata, a supported
non-blocking warning. Removed runtime hooks are hard incompatibilities and must
not stand in for warnings. The browser proof must retain staged privacy,
malicious-scan rejection, the missing-entrypoint rejection, and visible
warning/remediation assertions; warnings appear only after the proof runs the
targeted monitoring scan for the accepted release.

The local-auth runner waits for the initial Convex CLI push to finish before
checking function readiness. Listening HTTP alone does not mean modules and
indexes are deployed. Its disposable scratch directory stays on the local
backend storage volume, with a short path for Unix sockets. The runner owns and
removes only that scratch directory and its isolated backend state; it restores
pre-existing local state. Builds and browsers run as awaited managed children
so signal handlers can stop them; signal and normal-exit cleanup share one run.
The backend's HTTP transport timeout for the initial push is raised so a slow
external-deps build cannot be retried into the executor's shared build directory.
No test timeout or backend execution limit is raised.

The earlier generated-card browser failure included one-second execution
timeouts in multiple unrelated queries and mutations. It is not evidence of a
runtime-identity regression. Re-run its unchanged publish/scan/card lifecycle
against the real isolated backend and preserve any remaining failure separately.
