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
- Publish-time Inspector results carry an outcome: `clean`, `findings`,
  `tool_failure`, or `timeout`. Failures carry `{ stage, reason, message }`
  with reason `out_of_memory`, `target_unavailable`, `timeout`, or `error`.
  A tool failure never becomes a finding, an email, or a publish error; the
  Node action no longer fabricates a P0 `plugin-inspector-error` breakage.
- The publishing action races the Inspector action against
  `PACKAGE_INSPECTOR_PUBLISH_BUDGET_MS` (120 s). The deadline lives in the
  caller because Inspector's heaviest work is synchronous TypeScript analysis
  that would starve an in-action timer, and because an OOM kills the Node
  action outright; the caller sees a rejected `runAction` and records
  `tool_failure` with reason `out_of_memory`. A timed-out action may still run
  to completion; its result is discarded.
- Real findings, breakages included, are returned in `inspectorFindings`,
  staged with the attempt, and stored at finalization with `scanSource:
  "publish"`. Publish-time findings never email owners: owner email stays with
  reviewed notification runs of the bulk scan.
- Outcomes are recorded on `packageInspectorScanStates` (`outcome`, `failure`,
  `scanSource`). A publish-time failure that never resolved its target uses
  `targetOpenClawVersion: "unresolved"`, which matches no real target. Rows
  written before outcomes existed have no `outcome` and are completed scans;
  a pre-outcome bulk-scan failure therefore still reads as a completed scan
  until the next scan of that identity rewrites it.
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
- The bulk scan reports its own failures with the same classification so a
  timeout is distinguishable from other tool failures.

Running Inspector inside the publish request at all is transitional. The next
step moves it to monitoring after the release is accepted: the existing bulk
scan workflow, dispatched per accepted release plus the nightly sweep.

## Workspace and logging

Publish-time inspection owns one disposable workspace containing submitted
files and reports. Every owned operation finishes before recursive cleanup.
Cleanup never converts a failure into a pass or replaces the original findings.
A cleanup error is logged as an operational problem and never becomes a
finding. Stage logs contain package identity
and a fixed stage name, with Convex's action request id providing correlation.
They must not log credentials, file contents, or scratch paths.

The OpenClaw target is prepared by ClawHub, not by the dependency's
`openClawTargets.prepare`. That helper buffers the full npm packument and the
whole OpenClaw archive, then extracts every file. From 2026.9.6 (311 MB
unpacked) it peaks near or above the 512 MiB Node action limit on its own
(measured 607 MB max RSS for 2026.9.7), so every plugin publish, regardless of
plugin size, could die with "Node.js action execution ran out of memory"; the
2026.9.7 release lost ten small and large plugins that way. ClawHub resolves
`openclaw/latest` from the single-version document, streams the archive through
native zlib while verifying npm integrity, and keeps only `package/package.json`
and `package/dist/**/*.d.ts`, the inputs of the packed-package surface reader
(`reports.readOpenClawTargetSurface`). Nothing is written until the whole
archive verifies. The verified surface lives in a process-stable temp cache
keyed by version and integrity, is renamed into place atomically, and is shared
by concurrent or warm invocations. Targets are not pruned, because another
process may still read an older one; each is about 18 MB. The prepared
target must stay field-for-field identical to the dependency's output.

The static publish scan runs in its own Node action and must import only leaf
modules. Loading the `clawhub-schema` barrel (ArkType schemas) costs about
150 MB RSS before any file is read; with the whatsapp 2026.9.7 ClawPack (1,655
files, 22 MB) that measured 390 MB peak locally versus 252 MB with the
`clawhub-schema/textFiles` import, and the production action hit 512 MiB.

The publish gate does not request a Plugin SDK usage inventory. Inspector
0.4.1+ builds that inventory as a TypeScript program and type checker over
every packed source file, bundled `node_modules` included, plus the target's
declarations. With Inspector 0.4.3 against OpenClaw 2026.10.5 that measured
783 MB max RSS for the discord ClawPack (105 files), 783 MB for matrix (1,854
files) and 1,003 MB for whatsapp (1,680 files), versus 249/222/204 MB with
Inspector 0.4.0; matrix and whatsapp also exhaust a 384 MB V8 heap. Every
2026.10.5 publish of those three failed with a 512 MiB Node action OOM or a
five-minute CLI timeout. Compatibility findings are identical with and without
the artifact inventory, so publication gates on findings only and discards the
source-kind inventory Inspector 0.4.x always returns. Artifact inventories are
owned by the daily Package Inspector scan, which runs outside Convex and fills
releases whose inventory is missing or stale; a new release reports `missing`
until then. Attempts staged before this cutover still apply their stored
inventory at finalization until the 30-day attempt TTL expires.

Isolated successful retries establish recovery only, not a concurrency,
capacity, or memory root cause. On recurrence, retain the stage/request id and
obtain backend disk/inode and executor diagnostics before changing resource
limits or retry policy.

Browser warning fixtures use missing manifest display metadata, a supported
non-blocking warning. Removed runtime hooks are hard incompatibilities and must
not stand in for warnings. The browser proof must retain staged privacy,
malicious-scan rejection, and visible warning/remediation assertions.
Scanner claims begin only after the UI acknowledges that publication was
received; inspector target preparation happens before that staged attempt exists.

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
