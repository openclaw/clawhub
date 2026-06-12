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
