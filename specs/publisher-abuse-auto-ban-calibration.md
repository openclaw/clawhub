# Publisher Abuse Auto-Ban Calibration

Last updated: June 19, 2026

## Goal

ClawHub publisher-abuse scoring should find publishers that spam ClawHub with
large catalogs of low-adoption skills.

The auto-ban bucket must be high precision. A row should only be eligible for
automatic banning when independent signals agree that the publisher is a spam
publisher, not merely a publisher with one weak skill or a small catalog.

## Full-Production Calibration Run

On June 19, 2026, a read-only production run grouped active public skills by
publisher and scored them locally.

The raw candidate table was kept local because it contains production
moderation data. Only aggregate results and model conclusions are recorded here.

Run shape:

- Active skill rows read: `65,034`
- Public active skill rows scored: `64,512`
- Publishers scored: `22,118`
- Candidate / near-threshold rows retained for local audit: `667`

Backend pressure model result:

- Enforceable potential ban candidates: `1`
- Enforceable review rows: `145`

Portfolio prototype result:

- Enforceable ban-candidate rows: `42`
- Enforceable strong-review rows: `19`
- Enforceable watch rows: `63`

## Decision

Do not auto-ban the full portfolio prototype ban bucket yet.

Use a high-precision auto-ban bucket first:

```text
autoBanEligible =
  backendPressureLabel == "potential_ban_candidate"
  AND portfolioStatus == "ban candidate"
  AND publisher is not official
```

This yielded `1` auto-ban-eligible publisher in the full-production run.

Use the broader ban-priority review bucket for manual review and calibration:

```text
banPriorityReview =
  publisher is not official
  AND portfolioStatus == "ban candidate"
  AND backendPressureZ >= 2.25
```

This yielded `15` publishers in the full-production run.

## Why The Broader Bucket Stays Manual

The backend pressure model is conservative. It is good for avoiding false
positive auto-bans, but it misses some large-suite abuse patterns.

The portfolio prototype catches those large-suite cases because it asks whether
the whole catalog has enough adoption for its size. It also catches some
publishers that have partial adoption, so it is not safe enough to use as a
standalone auto-ban switch yet.

The current safe shape is:

```text
automatic ban = both models agree
manual ban review = portfolio says ban and backend pressure is high
review/watch = one model is concerned, but evidence is weaker
```

## Scoring Factors

Backend pressure:

```text
pressure =
  catalogPressure
  * (2 / installsPerSkill)^0.8
  * (0.05 / starsPerSkill)
  * (250 / downloadsPerSkill)^0.2
```

Catalog pressure:

```text
if skills <= 100:
  catalogPressure = skills / 100
else:
  catalogPressure = (skills / 100)^1.5
```

Production z-score:

```text
zScore =
  (log10(pressure) - meanLogPressure)
  / stdDevLogPressure
```

Small-catalog damping in the portfolio prototype:

```text
evidenceMaturity =
  1 / (1 + (50 / activeSkills)^4)
```

The `50` value is a baseline for publisher-level evidence. Catalogs below that
can still be suspicious, but they should not be close to automatic banning on
publisher-level evidence alone.

## Current Guidance

- Treat org publishers the same as user publishers for abuse scoring.
- Official publisher state may exclude a publisher from current backend
  enforcement, but it should not hide distributed abuse from review reports.
- Keep publishers with fewer than `50` active skills away from automatic bans
  unless another independent abuse system supplies stronger evidence.
- Keep raw production moderation tables local or in staff-only systems.
  Public PRs should record aggregate counts and policy decisions, not full
  candidate lists.
