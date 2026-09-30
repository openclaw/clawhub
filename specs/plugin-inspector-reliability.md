# Plugin Inspector operational failures

Publish-time inspection owns one disposable workspace containing submitted
files and reports. Every owned operation finishes before recursive cleanup.
Cleanup never converts a failure into a pass or replaces the original findings:
its error is a separate blocking finding. Stage logs contain package identity
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
