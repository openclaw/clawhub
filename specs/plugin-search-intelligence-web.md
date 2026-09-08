# Manual plugin-search attribution

ClawHub web demand is measured from deliberately entered, settled plugin searches,
not page views. The web UI only adds `searchSource=clawhub-web` to the combined
`GET /api/v1/plugins/search` request. It does not compute or submit counts,
official provenance, or user/device/session metadata.

## Input boundaries

- Plugins browse: the existing 250 ms debounce or explicit submit creates a
  one-navigation intent. The loader consumes it before dispatch. Initial URL
  loads, reloads, preloads, retries, filter changes, and pagination are unmarked.
- Homepage plugin listing: only plugin search-control edits create an intent;
  the existing debounce consumes it. Skills searches and filter/page refreshes
  are unmarked.
- Header (desktop and mobile): manual input is consumed after the existing
  180 ms debounce. A submit before settlement transfers the same intent into
  full search. A submit after settlement cannot count that intent twice.
- Full search: submitting the control in All or Plugins creates an intent.
  Merely loading a search URL or fetching plugins as a supporting family for
  Skills/Creators does not. Tabs and Load more do not create new intent.

Navigation intent exists only in memory; never put it in a query string, browser
history, local/session storage, or a network request identifier. Consume it
before dispatch so failed requests are not automatically retried as new demand.
An explicit repeat submit of an unchanged settled query also stays unmarked.

## Visible response contract

Marked requests ask for exactly the number of plugin rows shown. Global search
historically fetched `limit + 1` and hid the extra row; that hidden row must not
affect recorded official gaps. When a full-page marked response fills the visible
page, a separate **unmarked** request may determine whether Load more is needed.
Its rows never replace the original marked response. Header typeahead does not
need the extra pagination request.

Official counts remain backend-owned and deterministic from the exact response's
authoritative `isOfficial === true` metadata. Failed plugin searches show an error,
not an empty-result claim. A supporting pagination-probe failure does not discard
the successful visible search.

## Cancellation boundary

Cleared/unmounted input before debounce does not dispatch. Aborts propagate to the
HTTP request. The backend must exclude requests already aborted before its
observation commit. This is completed-search-boundary attribution, **not** a
browser-consumption receipt: a client cancellation after the server completes
cannot retract an observation. No receipt/ack protocol or identity is introduced.

## Validation

`src/__tests__/plugin-search-attribution.test.tsx` drives real TanStack routes,
rendered controls, and the real package API adapter. Only external Convex calls
and HTTP responses are substituted. It covers manual input/submit, URL load and
reload, retries, empty/canceled input, all four controls, the header handoff,
hidden-result probing, pagination, filters, and visible failures.

Release proof additionally needs a real browser against the integrated ClawHub
backend plus its matching raw observation, with source and authoritative result
counts checked together. Synthetic UI screenshots are not proof.
