# Official Publishers

`official` is a ClawHub publisher policy flag derived from the ClawHub-managed
official organization allowlist.

For now, Official means:

- legacy org publishers on the official allowlist are Official
- reserved-owner-verified org handles on the official allowlist are Official
  only after the handle has an active reservation for the rightful owner and
  that reserved owner owns the org publisher
- personal publishers for current members of an official org are Official

Official must not be accepted from uploaded skill or package metadata, and it
must not be derived solely from a user-claimable handle. New official org
handles must either be blocked from public unreserved creation or require an
active reservation/ownership check before the org or its members receive
Official status. Membership in any org outside the official allowlist does not
make a personal publisher Official. There is no generic admin endpoint for
marking arbitrary publishers Official.

The same policy signal appears in two places:

- Publisher/profile UI: official publishers show an `Official` badge.
- Owned package UI: new public packages from Official publishers use the
  `official` channel; private packages stay private.

`trustedPublisher` is an internal automated-publish permission. It does not make
a publisher or package Official.
