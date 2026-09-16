# Plugin publisher badges

The blue Official badge on plugin search results, list rows, and cards follows
skill identity: show it when the package is official **or its publisher is
official**. Publisher identity and package endorsement remain independent.

Public package catalog items expose `ownerOfficial` separately from `isOfficial`
and `channel`. Resolve it from the current owner and `officialPublishers` at
projection time, for both package and digest-backed listing paths. Do not promote
a package, alter official-only filters/ranking, or require a package/digest
backfill when a publisher badge is granted or revoked. Existing clients may omit
the additive field; existing package-level badges remain supported.

Use the existing OfficialBadge component. Do not special-case publisher handles
or fetch publisher profiles independently from each browser row.
