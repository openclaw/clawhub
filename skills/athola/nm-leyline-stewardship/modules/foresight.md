# Foresight: Designing for the choices of those who come after

## You are practicing foresight when...

- You choose a simple, transparent pattern over a clever
  abstraction that only you understand today
- You write tests that verify behavior rather than
  implementation details, so the next person can refactor
  freely
- You prefer reversible decisions over irreversible ones,
  leaving room for course correction
- You design interfaces to be extensible without requiring
  modification of existing code
- You ask "will the seventh person to modify this thank me
  or curse me?" before committing a design choice

## Practice

- Before adding an abstraction, check whether three concrete
  uses exist. If not, the abstraction is premature. Write
  the concrete version and let the pattern emerge.
- When choosing between two approaches, prefer the one that
  is easier to change later. Reversibility preserves the
  freedom of future contributors.
- Write tests that describe what the code does, not how it
  does it. Implementation-coupled tests become obstacles
  when the code needs to evolve.
- Name things for what they mean in the domain, not for
  their current technical role. Domain names survive
  refactors; technical names become lies.

## This is not foresight

- Premature optimization or over-engineering for
  requirements nobody has stated. Foresight protects future
  choices; it does not make them in advance.
- Analysis paralysis from imagining too many futures.
  Foresight makes the present decision reversible, then
  acts. It does not wait for certainty.
