# Auth Identity Invariants

ClawHub uses Convex Auth with GitHub OAuth for production user sessions.

Security invariant: a GitHub OAuth account may link to a ClawHub user only through
the auth-managed GitHub `providerAccountId`, which is the immutable GitHub
numeric account id stored in `authAccounts`. Mutable GitHub usernames and OAuth
profile email values are profile data, not account-linking keys.

The GitHub provider must keep `allowDangerousEmailAccountLinking: false`. This
prevents a fresh GitHub OAuth account whose profile exposes the same email as an
existing user from being attached to that user's ClawHub account. The visible
failure mode is a session whose GitHub login/avatar/handle belongs to one person
while persisted profile fields such as display name, bio, ownership, or API
tokens belong to another user.

The GitHub provider must also fail closed when the OAuth profile does not expose
a valid numeric `id`. Missing or malformed provider ids must never be coerced
into strings such as `"undefined"` and used as `authAccounts.providerAccountId`.
Malformed GitHub API responses during provider outages are authentication
failures, not anonymous or linkable GitHub identities.

When reading GitHub auth accounts for authorization-sensitive checks, duplicate
`authAccounts` rows for the same ClawHub user may only be treated as recoverable
when every row in a bounded reconciliation window has the same GitHub
`providerAccountId`. Any disagreement or overflow beyond that bounded window
means the account binding is ambiguous and must fail closed with
operator-visible diagnostics instead of choosing by creation time or any other
arbitrary tie breaker.

`users.me`, protected mutations, ownership checks, and API token issuance must
derive the actor server-side from Convex Auth (`getAuthUserId` via
`requireUser`/`getOptionalActiveAuthUserId`). They must not accept client-supplied
user ids, usernames, handles, or emails for authorization.

Staff recovery for a personal publisher whose GitHub principal is no longer
accessible must not rewrite or merge Convex Auth `authAccounts` rows. The only
supported permanent recovery path is an admin-only personal publisher recovery
operation that requires both immutable GitHub `providerAccountId` values, verifies
that each maps unambiguously to exactly one ClawHub user, confirms staff identity
continuity verification, moves the previous user's handle/personal-publisher
pointer out of the way, links the publisher to the verified replacement user,
updates every bounded legacy `ownerUserId` row that remains authoritative for the
recovered publisher's direct-owner workflows, and writes an audit log. Recovery
must also transfer any active protected-handle reservation for the recovered
handle to the replacement user so subsequent profile synchronization cannot
reassert the former user's authority over that handle. Recovery
must fail closed if the replacement user's current personal publisher has content
or GitHub source state that would be orphaned by the handoff. It must also fail
closed if recovered publisher resources are already attributed to a third user,
or if the affected primary resource rows exceed the bounded single-transaction
limit; those cases require an explicit resumable migration before recovery.
