# Publisher Abuse Dry Run

Status: active dry-run plumbing

## Intent

Publisher abuse scoring creates admin review work. It must not enforce policy by
itself.

`potential_ban_candidate` means high-priority human review. It does not mean an
automatic ban.

## Current Model

- Model version: `publisher-abuse-pressure.v1`
- Review threshold: `z >= 1.5`
- Potential ban candidate threshold: `z >= 2.5`
- Stars are the strongest trust signal.
- Installs are a medium trust signal.
- Downloads are weak because they are easier to fake.

The `2 installs / skill` pivot is only a rough review calibration point. It can
be the author plus one friend, so it is not proof of legitimacy or abuse.

## Dry-Run Boundary

The scheduled score refresh may write only:

- `publisherAbuseScoreRuns`
- `publisherAbuseScores`
- `publisherAbuseReviewNominations`
- `publisherAbuseReviewEvents`

Admin triage may also write a normal audit log entry for the triage status
change.

The score refresh must not patch:

- `users`
- `publishers`
- `skills`
- `skillSearchDigest`
- moderation fields
- soft-delete fields
- publish-limit fields

Any automatic ban, soft-delete, skill hiding, publish hold, rate limit, or
cleanup needs a separate product decision and a separate implementation.

Cron score collection must not scan every active skill for mixed skill/package
publishers that are missing the newer skill-only aggregate fields. Until those
aggregates are backfilled, cron skips those publishers for the run instead of
reading unbounded child rows or writing zero-engagement scores.

If cron reaches a publisher that is missing the base published skill count,
the scorer skips that publisher for the run. It must not write an all-zero pass
score for unknown publisher stats. Manual runs may derive the missing count from
active skills because they are operator-triggered, but that fallback must still
be bounded. If the active-skill fallback page is too large, manual runs skip the
publisher instead of scanning every child row in one mutation.
