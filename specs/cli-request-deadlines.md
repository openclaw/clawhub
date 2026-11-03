# CLI request deadlines

The shared CLI HTTP client bounds each Node and Bun registry attempt with one
total-transfer deadline. The clock starts when the attempt starts. It stays
armed while headers arrive and while the body is read. Receiving more bytes
does not reset it, and the timer is not replaced when headers arrive.

On Bun, curl `--max-time` already measured the whole transfer. On Node, the
abort used to be cleared after headers, so a stalled or slow body could run
without a deadline. `fetchWithTimeout` keeps that abort armed through `json`,
`text`, and `arrayBuffer`. The timer is cleared in `finally` after the attempt
settles, including when the deadline fires.

## Budgets

Ordinary JSON, text, binary, and skill zip reads use 15 seconds
(`REQUEST_TIMEOUT_MS`). Ordinary form uploads and binary uploads use 120
seconds (`UPLOAD_TIMEOUT_MS`). Package publish passes its own form timeout of
300 seconds (`PACKAGE_PUBLISH_REQUEST_TIMEOUT_MS`). That override stays. The
server unpacks and stores a ClawPack inside one HTTP action before it answers,
and 300 seconds matches the front-end function budget. A trusted-tooling
publish uses the same 300 second budget and does not retry.

## Retry

`runWithRetries` retries a failed attempt. The default is two retries after
the first attempt (`RETRY_COUNT`). Package publish asks for five retries,
except the trusted-tooling boundary, which asks for none. Each attempt starts
a new deadline.

A deadline failure is an `Error` whose message is `Request timed out after Ns`.
The retry runner treats that as a normal failure and tries again. Backoff
starts at 300 milliseconds, doubles on each failed attempt, caps at 5 seconds,
and adds up to 300 milliseconds of jitter. `Retry-After` is used only when the
failure is still an HTTP status error that carries a retry delay. If the
deadline fires while a 429 or 5xx body is being read, the helper throws the
timeout instead, so that attempt cannot run past the deadline on `Retry-After`.

## Slow downloads

A Node download that is still progressing at the deadline is aborted. A skill
zip or other read that used to finish in 24 seconds after a fast header now
fails at 15 seconds and then retries under the same budget. Uploads keep 120
seconds, and package publish keeps 300 seconds.

Whether Node should keep this total-transfer rule for a healthy download is
still a maintainer decision. This note records the behavior the client
implements. It does not record approval of that tradeoff.
