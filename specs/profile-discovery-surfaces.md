---
summary: "Profile, feed, search, and discovery surfaces for ClawHub account and publisher feeds."
read_when:
  - Adding account or publisher profile feed surfaces
  - Changing ClawHub search, browse, or discovery filters
  - Displaying claim, verified, official, review, scan, follow, or local approval labels
---

# Profile And Discovery Surfaces

Account and publisher feeds need human-readable ClawHub surfaces as much as
machine-readable feed routes. Users should be able to inspect who published an
entry, what state ClawHub actually knows, and which filters shaped the current
view without confusing identity, review, approval, and install safety.

This spec defines the profile and discovery surface expectations for future
account and publisher feeds.

## Surfaces

ClawHub should provide or extend these surfaces:

- account profile page
- publisher profile page
- account feed page
- publisher feed page
- search filter for followed publishers
- search filter for official publishers
- search filter or facet for reviewed entries when OpenClaw review state exists
- search filter or facet for scan state when ClawHub has scan state

Profile pages are the human-readable inspection surfaces. Feed pages expose the
machine-readable feed and should link back to the corresponding profile page.

The first shipped version should prioritize publisher profile and publisher feed
surfaces because packages, skills, official state, and publishing authority are
already publisher-scoped.

## Profile Content

Publisher profile pages should show:

- stable publisher identity
- display name, handle, avatar, and profile copy
- claim, verified, and official state when available
- follow control and current follow state
- public packages and skills owned by the publisher
- feed URL when the feed is public
- source, package digest, scan, and review state only when ClawHub has real data
  for those fields

Account profile pages may aggregate one or more publishers owned by or linked to
the account, but they should not imply that account-level identity automatically
grants official state to every publisher the account can manage.

Suspended or revoked publishers should remain resolvable for history and audit
continuity, but their pages should clearly show restricted status and should not
look active, endorsed, or safe to install from.

## Display Rules

Use separate labels for:

- claimed
- verified
- official
- OpenClaw reviewed
- OpenClaw scanned
- followed
- locally approved

Do not collapse these labels into one trust badge. A user should not have to
guess whether "trusted" means identity, official publisher status, scan result,
review result, local approval, or install eligibility.

Display labels only when ClawHub has the backing state. Do not infer review or
scan status from official state, follow state, package popularity, publisher
name, profile copy, or feed presence.

Package/source provenance should be shown separately from publisher identity.
For example, a publisher can be official while a specific package still needs
artifact integrity checks, scan results, OpenClaw review, or local approval
before install.

## Search And Discovery

Search and browse surfaces may add filters such as:

- people I follow
- publishers I follow
- official publishers
- reviewed entries
- scanned entries
- public account feeds
- public publisher feeds

These filters should narrow or rank already eligible results. They must not
override moderation, safety, visibility, deletion, scan, review, package
integrity, or local approval gates.

Unofficial and community results should remain discoverable unless the user
explicitly applies a stricter filter.

Official-publisher filters should mean exactly "publisher has ClawHub official
publisher state." They should not imply OpenClaw reviewed, scanned, locally
approved, or safe to install.

## Empty And Restricted States

Empty and filtered views should use plain user-facing explanations:

- followed-publisher filter with no follows
- followed-publisher filter with no matching results
- official-publisher filter with no matching results
- profile with no public feed entries
- profile restricted because the publisher is suspended or revoked
- feed unavailable because the profile is private or not public yet

Empty states should provide the next useful action, such as clearing a filter,
following publishers, viewing all results, or returning to the profile. They
should not expose private moderation or review evidence.

## Feed Page Behavior

Human-readable feed pages should:

- identify the account or publisher that owns the feed
- link to the raw machine-readable feed
- show the latest generated time and sequence when available
- show whether the feed is public, restricted, suspended, or revoked
- show entries with the same identity and trust labels used elsewhere

Machine-readable feed responses should stay focused on the feed contract. Rich
human explanation belongs on the profile/feed page, not inside every feed entry.

## Accessibility And Copy

Trust and state labels should have accessible names that describe the actual
state, not only icons or colors. Copy should be short and literal:

- "Official publisher"
- "Verified identity"
- "OpenClaw reviewed"
- "Scan available"
- "Following"
- "Locally approved"
- "Suspended publisher"
- "Revoked publisher"

Avoid labels such as "trusted" unless the exact trust source is shown nearby.

## Open Questions

- Does ClawHub need separate account profile URLs, or should publisher profiles
  remain the primary public surface?
- Should account feeds appear in global search by default?
- What is the first user-facing noun: account feed, publisher feed, creator
  feed, or profile feed?
- Which existing labels and icons should be reused for official, scan, and
  review state?
- Should public follower counts appear on profile pages, or should follows stay
  private initially?
