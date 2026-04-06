# Redundancy

Redundancy penalizes repeated or similar actions to compact the execution
trajectory.
It reduces token waste without quality loss.

## Formula

`Redundancy(a | s_t) = max(exact_match, semantic_similarity)`

## Exact Match

Check `actions_taken` for an identical action+target pair.
Returns 1.0 if found, 0.0 if not.

Examples:

- `retrieve("src/foo.py")` taken twice -> 1.0
- `tool_call(grep "pattern")` on the same pattern -> 1.0

## Semantic Similarity

The LLM compares the proposed action to each entry in `actions_taken` and
returns the highest similarity as a value in [0, 1].

Examples:

- Reading `src/foo.py` after reading `src/foo_test.py` -> ~0.3
  (related but different files)
- Grepping for "error" after grepping for "exception" -> ~0.6
  (semantically overlapping search targets)

Score closer to 1.0 when the proposed action would retrieve substantially
the same information.
Score closer to 0.0 when the files, targets, or intent are clearly distinct.

## Dispatch-Scope Redundancy

When evaluating whether to launch agent N+1, compare its scope to the
scopes of already-dispatched agents.
Overlapping file sets or search targets score high on this signal.

Ask: does this agent's assigned scope duplicate work already assigned to
a running or completed agent?
If yes, raise the redundancy score and consider narrowing the scope or
merging the agent into an existing one.

## Paper Evidence

Semantic redundancy filtering reduced token consumption ~10% (1294 to 1157
tokens per trajectory) with no quality loss (F1 moved from 0.2360 to
0.2370).
Source: Table 4 of Liu et al.
