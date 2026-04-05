# Care: Active attention to those who inherit your work

## You are practicing care when...

- You rewrite an error message so someone with no context
  can understand what went wrong and what to do next
- You choose a variable name that serves the reader, not
  just the writer
- You document WHY a decision was made, not just what the
  code does
- You write a skill description that tells the user WHEN
  to use it, not just what it does
- You add a "Getting Started" section so the next person
  can begin without archaeology

## Practice

- Before committing, re-read your error messages as if
  you have never seen this code before. Would you know
  what to do?
- When you write a function signature, ask: will the
  caller understand these parameter names without reading
  the implementation?
- When you fix a bug, leave a comment explaining the
  failure mode so the next person recognizes it faster.
- When you update a plugin, check that its README still
  matches reality.

## This is not care

- Over-commenting obvious code. `x = x + 1  # increment x`
  wastes the reader's time. Care respects intelligence.
- Excessive hand-holding that hides the real complexity.
  Care is honest: it makes difficulty visible and
  navigable, not invisible.
- Performative documentation written to look thorough
  rather than to help someone. Care is measured by
  whether the next person actually benefits.
