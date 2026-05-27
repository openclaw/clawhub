# Official Publishers

`official` is a ClawHub publisher policy flag derived from hard-coded
`openclaw` organization membership.

For now, Official means:

- the `openclaw` org publisher is Official
- personal publishers for current `openclaw` org members are Official

Official must not be accepted from uploaded skill or package metadata.
Membership in any org other than `openclaw` does not make a personal publisher
Official. There is no generic admin endpoint for marking arbitrary publishers
Official.

The same policy signal appears in two places:

- Publisher/profile UI: official publishers show an `Official` badge.
- Owned package UI: new public packages from Official publishers use the
  `official` channel; private packages stay private.

`trustedPublisher` is an internal automated-publish permission. It does not make
a publisher or package Official.
