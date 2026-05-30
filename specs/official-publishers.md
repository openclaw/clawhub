# Official Publishers

`official` is a ClawHub publisher policy flag derived from the ClawHub-managed
official organization allowlist.

For now, Official means:

- org publishers on the official allowlist are Official
- personal publishers for current members of an official org are Official

Official must not be accepted from uploaded skill or package metadata.
Membership in any org outside the official allowlist does not make a personal
publisher Official. There is no generic admin endpoint for marking arbitrary
publishers Official.

The same policy signal appears in two places:

- Publisher/profile UI: official publishers show an `Official` badge.
- Owned package UI: new public packages from Official publishers use the
  `official` channel; private packages stay private.

`trustedPublisher` is an internal automated-publish permission. It does not make
a publisher or package Official.
