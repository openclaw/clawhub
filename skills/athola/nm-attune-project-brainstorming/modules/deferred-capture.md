---
name: deferred-capture
description: Offer to capture non-selected approaches after
  Phase 5 decision.
category: integration
---

# Deferred Capture

After Phase 5 (Decision & Rationale), non-selected approaches
may still have merit for future projects or pivots.
This module defines when and how to capture them as deferred
items.

## When to Run

Run after `docs/project-brief.md` has been written and before
Phase 6 (Workflow Continuation) auto-invokes
`Skill(attune:project-specification)`.

## User Prompt

Count the non-selected approaches from Phase 3.
If there is at least one, display this prompt before
continuing:

```
N non-selected approaches have merit. Capture as deferred
items? [Y/n/select]
```

- **Y** (default): capture all non-selected approaches.
- **n**: skip capture entirely.
- **select**: display a numbered list of approaches and capture
  only the ones the user chooses.

Do not block workflow continuation waiting for a response
beyond 30 seconds.
If no response is received, treat it as **n** and continue.

## Capture Command

For each approach to be captured, run:

```bash
python3 scripts/deferred_capture.py \
  --title "Alternative: <approach-name>" \
  --source brainstorm \
  --context "<pros summary>. Not selected because: <user rationale>"
```

The `<pros summary>` should be a single sentence drawn from
the approach's Pros list in the project brief.
The `<user rationale>` should be the rejection reason recorded
in Phase 5 under "Rejected Approaches".

## Behavior Rules

- Only capture on explicit confirmation (Y or select).
  Default behavior when the user skips the prompt is no
  capture.
- If `scripts/deferred_capture.py` is not present, log a
  warning and skip capture rather than blocking continuation.
- After capture (or skipping), proceed immediately to Phase 6
  without further prompts.
