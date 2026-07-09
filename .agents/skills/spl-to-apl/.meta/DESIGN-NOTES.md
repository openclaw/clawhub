# spl-to-apl Skill Design Notes

Iterative findings from improving the skill's schema-read behavior.

## Problem Statement

The skill translates SPL to APL. Some Axiom datasets store numeric-looking fields as strings (e.g., `status` in sample-http-logs). This causes silent failures:
- `status >= 500` compiles and runs
- But does string comparison, returning wrong results
- Correct: `toint(status) >= 500`

The type information is dataset-specific and lives in `reference/dataset-schemas.md`. We want the model to read this file before translating.

## Metrics

- **skill-loaded**: Does model call the skill tool? (always 100%)
- **schema-read**: Does model call readFile on schema? (target: higher)
- **results-match**: Does generated APL produce correct results? (primary metric)

## Baseline

Original skill (no schema instruction): 0% schema-read, 77.78% results-match

The 2/9 failing cases are specifically ones requiring toint() casts.

## Iterations

### Attempt 1: Explicit "REQUIRED" Section

```markdown
## Before Translating — REQUIRED

**Check the target dataset schema.** Run `['dataset'] | getschema` or see `reference/dataset-schemas.md`.
```

Result: 33% schema-read, 77.78% results-match

Observation: "REQUIRED" label helps but isn't enough.

### Attempt 2: Explicit readFile Instruction

```markdown
## Step 1: Read the Schema (REQUIRED)

**ALWAYS read `reference/dataset-schemas.md` before writing any APL.**

Call `readFile("reference/dataset-schemas.md")` now. Do not skip this step.
```

Result: 33% schema-read, 77.78% results-match

Observation: Imperative "call X now" doesn't significantly improve compliance.

### Attempt 3: Example Workflow (Best Schema-Read)

```markdown
### Example workflow

\```
1. User asks: translate `index=sample-http-logs | stats count(eval(status>=500))`
2. Read schema → status is "string" not int
3. Output: | summarize countif(toint(status) >= 500)
           ^^^^^^^^^ cast required
\```
```

Result: **66% schema-read**, 55.56% results-match

Observation: Workflow example doubled schema reads BUT model copied backticks and explanatory text into APL output, causing parse errors.

**Key insight**: Examples are load-bearing for driving behavior, but copyable artifacts in examples pollute output.

### Attempt 4: Remove Example, Keep Explanation

```markdown
### Why this matters

If schema shows `status` is type `string` (not int), then `status >= 500` does string comparison...
```

Result: 11-22% schema-read, 77.78% results-match

Observation: Without workflow example, schema-read drops significantly.

### Attempt 5: Inline readFile Call (Current)

```markdown
## Before Translating

Read the schema file first: `readFile("reference/dataset-schemas.md")`

Numeric-looking fields may be stored as strings...
```

Result: 11% schema-read, 77.78% results-match

## Design Principles Applied

From [agent skill design principles](file:///Users/bdsqqq/commonplace/01_files/2026-01-15%20agent%20skill%20design%20principles%20--%20type__reference%20source__agent%20area__work.md):

### "Explicit vocabularies over references"

> "skills that say 'read X for details' without embedding critical constraints risk agents never following the link"

This explains why passive "see reference/..." instructions don't work. The model treats them as optional.

### "Examples are load-bearing for pattern-matching skills"

The skill is pattern-matching (teaches HOW to translate). Examples drive behavior. But:
- Example that maps exactly to eval case = overfitting
- Example with copyable syntax = output pollution

### "Lost in the middle"

Critical info should be at beginning or end. Schema instruction at top of skill body is correct placement.

## The Core Tension

| Approach | Schema-Read | Results-Match | Problem |
|----------|-------------|---------------|---------|
| No instruction | 0% | 78% | Doesn't learn types |
| Passive instruction | 11-33% | 78% | Often ignored |
| Workflow example | 66% | 56% | Pollutes output |

Workflow examples drive the behavior but introduce copyable artifacts that get included in APL output.

## Why This Is Hard

The schema data is **dynamic** (varies by dataset). We can't embed "status is string" in the skill body — that's true for sample-http-logs but not other datasets.

The skill must teach the **behavior** (check schema) not embed the **data** (specific types).

But teaching behavior requires examples, and examples get copied.

## Open Questions

1. Can we structure examples to demonstrate workflow without copyable APL fragments?
2. Should the eval accept lower schema-read if results-match is high?
3. Is there a way to make readFile calls "mandatory" in the harness?
4. Would a two-phase approach work (schema read → translation)?

## Current State

- skill-loaded: 100%
- schema-read: 11%
- results-match: 77.78%

The 2 failing cases specifically require toint() casts. Model knows about the pattern (mentioned in skill body) but doesn't consistently check schema to know when to apply it.

## Backtick Pollution Problem

The skill uses backticks to show syntax in command mapping tables:

```markdown
| `stats` | `summarize` | Different aggregation syntax |
```

Model sometimes copies these backticks into APL output:
- Error: "invalid input text `perc50`, `perc9..."
- Error: "invalid input text `sample-http-log..."

This is distinct from the schema-read problem. Even without schema instruction backticks, the mapping table backticks can pollute output.

**Possible fixes:**
1. Remove all backticks from skill (loses syntax highlighting)
2. Use different formatting (bold, italics)
3. Add explicit "output only valid APL, no markdown" instruction
4. Accept some output pollution as cost of clear documentation

## Summary Table

| Version | schema-read | results-match | Notes |
|---------|-------------|---------------|-------|
| Original baseline | 0% | 78% | No schema instruction |
| "REQUIRED" section | 33% | 78% | Label helps slightly |
| Workflow example | 66% | 56% | Best reads, worst output |
| Backtick readFile | 11-22% | 55-78% | Variable, output pollution |
| No backticks | 11% | 67-78% | Cleaner but lower reads |
| + "Output: Valid APL only" | 11% | 78% | Output instruction helps edge cases |

## Next Steps

- [ ] Try example that shows schema-checking workflow without using test case data
- [ ] Consider if 78% results-match is acceptable baseline
- [ ] Explore harness changes to enforce schema read
- [ ] Test removing ALL backticks from skill to isolate output pollution
