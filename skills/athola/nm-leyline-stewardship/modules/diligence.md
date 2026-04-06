# Diligence: Disciplined practice of quality in small things

## You are practicing diligence when...

- You run format, lint, and test before every commit,
  not because a hook forces you but because quality is
  how craft improves
- You fix the typo you noticed in a file you were
  editing for something else
- You remove the dead import, add the missing type hint,
  or update the stale example while you are nearby
- You follow through on the campsite rule even when the
  diff is already large enough
- You write the test that would have caught the bug you
  just fixed

## Practice

- Run `make format && make lint && make test` before
  every commit. Treat quality gates as practice, not
  obstacles.
- When you notice something small that is wrong, fix it
  now. It takes seconds and pays dividends for every
  future reader. This is Principle 3 in action.
- When you add a bugfix, add the regression test. The
  fix solves today's problem; the test prevents
  tomorrow's.
- Track your voluntary improvements with the stewardship
  tracker. What gets noticed gets repeated.

## This is not diligence

- Busywork disguised as thoroughness. Polishing code
  nobody reads while ignoring broken tests is
  avoidance, not diligence.
- Rigid adherence to process when the process is not
  serving the goal. Diligence is disciplined, not
  mechanical. If a step adds no value, question it.
