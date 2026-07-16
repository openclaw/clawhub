---
summary: "Publisher follow graph and activity timeline behavior for ClawHub."
read_when:
  - Adding publisher follow or unfollow behavior
  - Changing public follower or following lists
  - Adding activity timeline behavior for followed publishers
---

# Publisher Follow Graph And Activity Timeline

Following a ClawHub publisher is a discovery preference. It is not a trust
grant, install grant, review decision, scan result, or local approval.

## Follow Identity

Follows are keyed by stable publisher ids and the authenticated follower user
id. Handles, display names, profile URLs, and feed URLs are mutable display
metadata and must not identify an edge.

Follow and unfollow operations are idempotent. A user cannot follow their own
personal publisher. A publisher must pass ClawHub's canonical public visibility
check before it can be followed or returned by a list.

The stored follower user id is private. Public follower and following APIs
return visible publisher identities only:

- `GET /api/v1/publishers/{publisherId}/followers`
- `GET /api/v1/publishers/{publisherId}/following`

Both lists use bounded cursor pagination and return `nextCursor: null` at the
end. Organization publishers can have followers, but do not have a following
list because follow ownership is currently user-scoped.

Hard deletion of either the follower account or followed publisher removes the
corresponding edges in bounded, resumable batches.

## Activity Timeline

ClawHub should expose a pull-based activity timeline for followed publishers,
similar to GitHub's following feed. It should not fan every publish out as an
unread notification: large publishers can publish hundreds of artifacts and
would make that model noisy.

Timeline events carry stable publisher and artifact ids, immutable event time,
and enough public metadata to render an update. They must not contain secrets,
private review evidence, raw signing keys, private source URLs, or unpublished
package metadata.

OpenClaw may separately notify users about updates to artifacts present in the
local lockfile. That filtering belongs in OpenClaw because ClawHub does not know
which artifacts are installed locally.

## Search And Trust

Follow state may power a following filter, break ties among already relevant
results, or build a personalized timeline. It must not make unrelated results
eligible, override moderation or visibility, bypass artifact integrity checks,
or bypass local install policy.

Public social graph endpoints need normal rate limits and must omit deleted,
deactivated, hidden, or otherwise non-public publishers. Follower counts are
derived from visible identities rather than treated as authorization or trust
signals.
