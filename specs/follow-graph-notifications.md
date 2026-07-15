---
summary: "Follow graph and notification behavior for ClawHub account and publisher feeds."
read_when:
  - Adding follow or unfollow behavior for accounts, publishers, or feeds
  - Adding feed notification events or delivery channels
  - Changing search or discovery filters for followed publishers
---

# Follow Graph And Notifications

Following a ClawHub account, publisher, or feed is a discovery and notification
preference. It is not a trust grant, install grant, review decision, scan
result, or local approval.

This spec defines the follow graph and notification boundaries for future
account and publisher feeds.

## Product Behavior

ClawHub should allow signed-in users to:

- follow a public account or publisher
- unfollow a previously followed account or publisher
- see followed publishers in discovery surfaces
- filter search or browse results to people and publishers they follow
- opt into notifications for feed publication and material feed-entry changes

The first implementation should prefer publisher-scoped follows when a public
publisher identity exists. Account-scoped follows can still be useful for person
or organization profiles, but install and package discovery should resolve
through stable publisher ids.

## Follow Identity

Follows must be keyed by stable ClawHub ids, not display names, handles, slugs,
profile URLs, or feed URLs.

At minimum, a follow row should preserve:

- follower user id
- followed account id or publisher id
- followed identity kind
- creation time
- last updated time
- notification preference
- muted or paused state when supported

Follow and unfollow operations must be idempotent. Client retries should not
duplicate rows, emit duplicate notification state, or fail because a prior
attempt already succeeded.

Omitting a notification preference on an idempotent follow retry preserves the
existing preference. It must not silently unmute a follow. Follow-list reads
are private to the authenticated user, cursor-paginated, and bounded even when
inactive publishers or search filtering make the result sparse.

Publisher rename, handle change, profile URL change, or ownership change must
not silently transfer a follow to an unrelated identity. If ownership changes
materially, ClawHub should preserve the stable id and emit a material-change
event or require an explicit follow reset, depending on the risk.

## Events

Suggested event types:

- `publisher.feed.published`
- `publisher.feed.entry.added`
- `publisher.feed.entry.updated`
- `publisher.feed.entry.removed`
- `publisher.official_state.changed`
- `publisher.claim_state.changed`
- `publisher.suspended`
- `publisher.reinstated`
- `publisher.revoked`

Events should carry stable ids, sequence or revision references, event time, and
enough public display metadata for notifications. They should not carry private
review evidence, secrets, raw signing keys, private source URLs, or unpublished
package metadata.

## Notification Rules

Notifications should link users back to ClawHub profile, feed, package, skill,
or review surfaces. They must not auto-install content or imply that a followed
publisher is safe to install from.

Notification copy must preserve the trust boundary:

- "followed publisher posted an update" is allowed
- "official publisher changed status" is allowed when backed by ClawHub state
- "safe to install" is not allowed based only on a follow
- "approved for you" is not allowed unless the current local context actually
  has that approval

Users should be able to pause, mute, or opt out of follow notifications without
unfollowing the publisher.

## Search And Discovery

Search and browse filters may use follow state to help users find publishers
they already care about. Follow state may:

- power a "people I follow" or "publishers I follow" filter
- break ties inside an already relevant result set
- build a personalized activity feed
- prioritize notification delivery preferences

Follow state must not:

- make an otherwise unrelated result eligible for a query
- override moderation, safety, visibility, or deletion state
- bypass OpenClaw review
- bypass scans
- bypass package artifact integrity checks
- bypass local approval or install policy

## Privacy

Follow lists should be private by default unless ClawHub deliberately ships a
public social graph.

If public follow lists are introduced later, the design must define:

- opt-in or opt-out behavior
- profile display rules
- blocked or suspended publisher behavior
- export and deletion behavior
- abuse controls for follower-count manipulation

Private follow state should still be usable for the current user's own search,
notifications, and profile controls.

## Abuse Controls

The follow and notification system should handle:

- spam publishers posting high-frequency feed updates
- mass rename or profile churn
- compromised official or verified publishers
- follower-count manipulation
- notification fanout spikes
- repeated follow/unfollow churn
- suspended, revoked, hidden, or deleted publishers

Notification fanout should be rate limited, deduplicated, and resumable.
ClawHub should prefer durable event processing with replay or backfill semantics
over best-effort notification sends that cannot recover missed changes.

## Replay And Backfill

Clients and notification workers may miss events. The contract should define how
they recover:

- feed sequence or revision cursor
- notification event cursor
- maximum replay window
- behavior when the cursor is too old
- idempotent reprocessing behavior
- dedupe key for each emitted notification

Replay should never create duplicate user-visible notifications for the same
event and channel.

## Open Questions

- Should the first shipped follow model be publisher-scoped only?
- Should account-scoped follows later aggregate all publishers controlled by an
  account or organization?
- Which notification channel ships first: in-app, email, webhook, RSS-style
  polling, or OpenClaw client sync?
- Should users be notified when a followed publisher is suspended, revoked, or
  reinstated?
- Should follower counts be public, private, delayed, or omitted?
