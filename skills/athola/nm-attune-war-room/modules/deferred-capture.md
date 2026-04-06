---
name: deferred-capture
description: Capture rejected COAs and dissenting-view items
  after Phase 5 voting.
category: integration
---

# Deferred Capture

After Phase 5 (Voting + Narrowing), capture rejected COAs and
any future-work items from the Dissenting Views section so
nothing valuable is lost.

## When to Run

Run this module immediately after the Supreme Commander
publishes the final decision document and before the war-room
session closes.

## Capturing Rejected COAs

For every COA that was eliminated during voting, check whether
it received at least one Borda vote.
If it did, capture it as a deferred item:

```bash
python3 scripts/deferred_capture.py \
  --title "COA: <coa-title>" \
  --source war-room \
  --context "<rejection rationale from Supreme Commander>" \
  --artifact-path "<path to coa file in strategeion>" \
  --session-id "<war-room-session-id>"
```

A COA that received zero Borda votes across all expert roles
does not need to be captured.

## Capturing Dissenting-View Items

After capturing rejected COAs, scan the "Dissenting Views"
section of the Supreme Commander decision document.
For each item that describes future work (identified by phrases
such as "should revisit", "worth exploring", "consider in
phase N"), capture it using the same script:

```bash
python3 scripts/deferred_capture.py \
  --title "COA: <coa-title>" \
  --source war-room \
  --context "<rejection rationale from Supreme Commander>" \
  --artifact-path "<path to coa file in strategeion>" \
  --session-id "<war-room-session-id>"
```

Use the dissenting view text as the `--context` value.
Omit `--artifact-path` if no coa file corresponds to the item.

## Behavior Rules

- Capture is automatic: do not prompt the user for
  confirmation.
- Capture every qualifying COA in a single pass before
  closing the session.
- If `scripts/deferred_capture.py` is not present in the
  repository, log a warning and skip capture rather than
  blocking the war-room close.
- The session ID must match the ID stored in
  `.attune/war-room-session.json`.
