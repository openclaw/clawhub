# Manual catalog-search attribution

ClawHub web demand is measured from deliberately entered, settled plugin and skill
searches, not page views. The web UI adds `searchSource=clawhub-web` to the existing
combined plugin HTTP search, canonical skill HTTP search, or filtered native skill
action. It does not compute or submit counts,
official provenance, or user/device/session metadata.

## Input boundaries

- Plugins browse: the existing 250 ms debounce or explicit submit creates a
  one-navigation intent. The loader consumes it before dispatch. Initial URL
  loads, reloads, preloads, retries, filter changes, and pagination are unmarked.
- Homepage listing: manual Featured/Official/New plugin and skill input
  creates a per-catalog intent consumed by the existing debounce. Plugin and Skill Trending
  filter their ranked feeds and create no search intent. Filter, view, and page changes
  clear pending intent and remain unmarked.
- Native Skills browse: manual settled input uses the canonical skill HTTP search;
  initial URLs, repeated normalized input, filters, refresh, and pagination are unmarked.
- Header (desktop and mobile): manual input is consumed after the existing
  180 ms debounce. A submit before settlement transfers the same intent into
  full search. Plugin and skill consumption are independent within the same ephemeral
  intent. A submit or footer navigation after settlement cannot count either twice.
- Full search: submitting All creates independent plugin and skill intents; submitting
  a catalog tab creates only that catalog's intent. Merely loading a search URL or
  fetching a supporting family does not. Tabs and Load more create no new intent.

Navigation intent exists only in memory; never put it in a query string, browser
history, local/session storage, or a network request identifier. Consume it
before dispatch so failed requests are not automatically retried as new demand.
An explicit repeat submit of an unchanged settled query also stays unmarked.

## Visible response contract

Marked requests ask for exactly the number of catalog rows shown. Global search
historically fetched `limit + 1` and hid the extra row; that hidden row must not
affect recorded official gaps. When a full-page marked response fills the visible
page, a separate **unmarked** request may determine whether Load more is needed.
Its rows never replace the original marked response. Header typeahead does not
need the extra pagination request.

Official counts remain backend-owned and deterministic from the exact response's
canonical catalog metadata, as specified in `plugin-search-intelligence.md`.
Failed plugin or skill searches show an error,
not an empty-result claim. A supporting pagination-probe failure does not discard
the successful visible search.

## Cancellation boundary

Cleared/unmounted input before debounce does not dispatch. Aborts propagate to the
HTTP request. The HTTP owner excludes requests already aborted before its
observation commit. The native homepage Convex action has no Request abort signal;
once dispatched, a completed marked result may be recorded after navigation. The
existing action transport does not automatically retry. This is completed-search-boundary attribution, **not** a
browser-consumption receipt: a client cancellation after the server completes
cannot retract an observation. No receipt/ack protocol or identity is introduced.

## Validation

`src/__tests__/plugin-search-attribution.test.tsx` drives real TanStack routes,
rendered controls, and the real package API adapter. Only external Convex calls
and HTTP responses are substituted. It covers manual input/submit, URL load and
reload, retries, empty/canceled input, all four controls, the header handoff,
hidden-result probing, pagination, filters, and visible failures.
Skill attribution and homepage tests cover independent per-catalog consumption,
the native action's shelf-only boundary, and exclusion of Trending local filtering.

Release proof additionally needs a real browser against the integrated ClawHub
backend plus its matching raw observation, with source and authoritative result
counts checked together. Synthetic UI screenshots are not proof.
