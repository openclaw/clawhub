# Content-Rights Proxy Timeout and Recovery

## Intent

The staff content-rights proxy (`convex/httpApiV1/contentRightsV1.ts`) forwards
authenticated admin reads and correspondence writes to the Hermit origin. Both
outbound fetches are bounded by a ten-second abort deadline
(`HERMIT_CONTENT_RIGHTS_FETCH_TIMEOUT_MS`), and the uncertain-write recovery
contract is fixed so a stalled origin can never produce duplicate emails.

Background: issue #3671 (unbounded proxy fetches could pin the Convex action
until the platform limit when Hermit stalled).

## The ten-second budget

- Applies to both the GET case fetch and the POST correspondence fetch.
- Rationale: ten seconds is generous for a responsive forms backend —
  representative correspondence uploads, including a 10 MB attachment, were
  measured completing in well under one second end-to-end through the proxy —
  while staying far below the Convex platform action limit, so a stalled
  origin fails fast and free instead of pinning the action.
- The constant is exported from `contentRightsV1.ts`. If production timing
  evidence ever shows representative uploads approaching the budget, the
  calibration move is to split a second exported POST constant; no structural
  change is needed.

## Failure contract

- Deadline expiry (or any outbound fetch failure) surfaces through the
  existing catch path as `502 Hermit content rights service unavailable`.
- The proxy performs **no automatic retries**. A timed-out POST must not be
  assumed to have been rolled back on Hermit's side: the deadline can expire
  after the archive record is already stored.
- Scope of the POST: the correspondence POST is the **archive** operation
  (staff workflow: `clawhub-admin email send` first, then
  `clawhub-admin content-rights record-correspondence` with the provider
  message id). The POST never sends an email; the two effects — send and
  archive — must be recovered independently.

## Uncertain correspondence POST recovery

- `GET /api/v1/content-rights/{caseId}` may show the archive entry; if it is
  present the archive write landed and no further archive action is needed.
- If the entry is absent (or the read is inconclusive), reconcile the exact
  correspondence to be archived (text, direction, provider message id) and
  re-run the archive POST to repair the archive. This can create a duplicate
  archive entry, so reconcile before resubmitting; it cannot send an email
  again because the POST has no send effect.
- Email-send recovery is a separate question tracked at the `email send`
  step (dry-run by default; the sent provider message id is what the archive
  record references). A timed-out archive POST is never a reason to re-run a
  send.
- No duplicate-free guarantee: after archive repair the correspondence log
  may contain duplicate entries. Send de-duplication is the staff
  responsibility at the `email send` step.

## Related records

- `docs/http-api.md` → "Staff Content rights proxy" (staff-facing summary).
- `convex/httpApiV1/contentRightsV1.test.ts` (timeout regressions).
