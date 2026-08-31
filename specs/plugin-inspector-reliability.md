# Plugin Inspector operational failures

Publish-time inspection owns one disposable workspace containing submitted
files, the exact resolved OpenClaw target, and reports. Every owned operation
finishes before recursive cleanup. Cleanup never converts a failure into a pass
or replaces the original findings: its error is a separate blocking finding.
Stage logs contain package identity and a fixed stage name, with Convex's action
request id providing correlation. They must not log credentials, file contents,
or scratch paths.

The dependency's target archive extraction is synchronous before its cleanup.
The earlier release's target-preparation `ENOTEMPTY` and generic action failures
do not establish an outer-workspace cleanup race. Likewise, a small submitted
plugin followed by `ENOSPC` does not establish an oversized plugin: target
download/extraction also uses disk. Isolated successful retries establish
recovery only, not a concurrency, capacity, or memory root cause. On recurrence,
retain the stage/request id and obtain backend disk/inode and executor diagnostics
before changing resource limits or retry policy.

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
No test timeout or backend execution limit is raised.

The earlier generated-card browser failure included one-second execution
timeouts in multiple unrelated queries and mutations. It is not evidence of a
runtime-identity regression. Re-run its unchanged publish/scan/card lifecycle
against the real isolated backend and preserve any remaining failure separately.
