# HTTP Error Semantics for Publish Paths

## Intent

Publish-path HTTP responses must say what actually happened, so publishers and
the CLI make the right retry decision:

- `4xx` means the request itself was rejected: validation, authentication,
  permission, conflict, or a real rate-limit `429`. The body is the real reason.
- `503` with `Retry-After` means a transient platform failure. It is never a
  validation failure and never a rate limit, so it carries no rate-limit headers.
- Rate-limit headers and reset hints appear only on a real `429`
  (`rate-limiting.md`).

During the November 2026 outage, Convex system errors (`InternalServerError:
Transient error while ...`, overload, write admission) were caught by publish
handlers' generic `catch` and returned as `400`, while every response also
carried limiter headers. The CLI therefore did not retry and printed a reset
hint, telling publishers they were rate limited.

## Server classification

`getTransientConvexErrorKind` (`convex/lib/httpUtils.ts`) classifies:

- `system`: captured Convex platform-failure shapes only: `InternalServerError: `,
  `Overloaded: `/`OverloadedError: `, `Transient error while `, `Your request
  couldn't be completed. Try again later.`, and typed `CommitterFullError: Too
  many writes ...`.
- `write_conflict`: optimistic-concurrency failures (`Document(s) ... changed
  while this mutation was being run`, `optimistic concurrency`, `write conflict`).

Application `ConvexError`s are never classified, even if their text quotes a
platform message; matching uses code-prefix signatures rather than bare words so
user-supplied text inside validation messages does not turn a rejection into a
retry loop.

`transientConvexErrorResponse` (`convex/httpApiV1/shared.ts`) turns a classified
error into `503` with `Retry-After` (`1` for write conflicts, `2` for system
errors, or Convex's own write-admission `(reset in Ns)` clamped to 2-30s). That
reset text describes backend capacity, so it moves into `Retry-After` and is
removed from the body rather than echoed as a quota reset. The body keeps the
Convex request ID for correlation.

Applied on: skill publish (v1 and legacy `/api/cli/publish`), skill upload-URL
and upload, legacy `/api/cli/upload-url` (previously mapped everything to 401),
package publish, package operations, trusted-publish token mint, publish
recovery, and API-token auth in `requireApiTokenUserOrResponse` /
`requirePackagePublishAuthOrResponse` / legacy whoami (a platform failure
reading a token must not tell a valid publisher to log in again).

## Ambiguous outcomes and one-shot state

A ticketed JSON skill publish (v1, and legacy `/api/cli/publish` with stored
file IDs) consumes its upload tickets once the pending version persists; if a
later step fails, compensation discards the files. Resending that request can
never succeed, so a transient failure after `onFilesPersisted` answers `409`
without `Retry-After` and tells the publisher to check the version and run
publish again (which uploads the files again). Failures before persistence stay
retryable `503`s.

Before package publish dispatch, the request owns every stored blob and deletes
them on failure, so a retry is a clean fresh attempt. After dispatch (and for
publish recovery) the action may have committed before the failure surfaced; the
503 body says the outcome is unknown and that a retry reporting an existing
version means the earlier attempt completed. Skill upload reclaims the blob on
any failure; a retry with the same ticket attaches exactly one blob, and an
attachment that committed despite the error makes the retry fail as a used
ticket rather than attach a second blob.

## CLI retry contract

`packages/clawhub/src/http.ts` retries `429`, `5xx`, network failures, and
(for older servers) `400`/`401` bodies carrying a full Convex platform sentence
(`InternalServerError: Transient error while`, `Your request couldn't be
completed`, typed `CommitterFullError`, or a write conflict). It never body-sniffs
`409`, which current servers use for "do not resend".
Backoff is bounded and jittered: the wait is `max(Retry-After,
exponential backoff)` plus jitter of `max(250ms, Retry-After/4)`. A
`Retry-After` above 60s is not waited out; the command fails fast with the hint.
No sleep follows the final attempt. Quota (`remaining`) and `reset in` hints are
shown only for a `429`; `retry in Ns` reflects any `Retry-After`. When a retried
temporary failure is followed by a non-retryable rejection (for example "version
already exists" after an ambiguous publish), the final message keeps the earlier
failure so the publisher can tell the version may already be published.

Follow-up: a skill upload whose attachment commits but still reports a transient
error deletes the blob the ticket now references (pre-existing); the retry then
fails as a used ticket. Reconciling would need a ticket read-back after the error.
