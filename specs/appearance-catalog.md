# Shared Appearance discovery

ClawHub exposes one primary Appearance navigation entry, with Themes (default)
and Lobster Packs child views. The view and submitted search query are URL state.
The existing plugin category and package detail URLs remain available unchanged.
The shared desktop header gives navigation its natural width so the extra primary
entry cannot overlap search; secondary links use the existing More menu below
1440px, while the existing tablet/mobile navigation boundary remains unchanged.

## Storage and actions stay separate

Themes use only the dedicated themes HTTP namespace and isolated tables from
specs/themes.md. Browsing themes never queries or writes plugin records. Theme
cards link to a pinned immutable version; detail displays normalized data and
SHA-256. Its contained color preview cannot theme ClawHub itself or execute CSS.
There is no invented CLI, cross-origin install link, or one-click installation.
The detail explains the OpenClaw Appearance installation surface.

Lobster Packs use the existing public plugin catalog with category=lobster-packs.
Cards link to existing trusted package details and their installation flow. A
catalog view is not a collection encounter and never records one. No changes to
plugin validation, permissions, publication, installation, or feed semantics.

## Query ownership

Every view/query pair owns a fresh request lifecycle and opaque cursor chain.
Switching either discards old results and cursors; cancellation and request identity
prevent late responses from contaminating the next view. Pagination errors retain
the previous items and cursor so Retry repeats the failed page, not page one or a
query from the other registry. Empty filtered pages may still carry a continuation
cursor and must offer Load more. Search never converts a transport failure into a
successful empty result. Requests have a bounded timeout and explicit retry.

## Verification

Cover separate endpoint/category selection, pinned versions and rejected unsafe
theme definitions; loading, empty, failed-first-page, retry, failed-pagination,
deduplication, filtered-empty-page continuation and stale-response/view changes.
Browser proof must run the real app against disposable local Convex fixtures;
transport faults may be injected only for labeled failure-state proof. Preserve
before/after and mobile evidence outside product source. No production writes.

## Public namespace compatibility

The public catalog lives at `/~appearance`, not `/appearance`. Bare `/<handle>`
URLs are existing canonical publisher profiles; a new static `/appearance`
route would silently take over an existing or future account. The leading `~`
is rejected by the publisher-handle grammar, so the app-only route cannot own
a valid publisher name. `/appearance` and all existing profile and package links
keep their original resolution. Do not reserve or migrate that publisher handle.
