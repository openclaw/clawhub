---
date: 2026-01-28
thread: https://ampcode.com/threads/T-019c0497-6c51-7113-a9a0-bf9ea2efe9e2
branch: feat/spl-to-apl-v2-skill
status: paused
keywords:
  - skill-design
  - schema-read
  - eval
  - progressive-disclosure
---

# schema-read behavior findings

attempted to improve model's schema-read rate (calling readFile on reference/dataset-schemas.md before translating). found fundamental tension between driving reads and maintaining output quality.

## results

| approach | schema-read | results-match | problem |
|----------|-------------|---------------|---------|
| no instruction (baseline) | 0% | 78% | doesn't learn types |
| "REQUIRED" label | 33% | 78% | often ignored |
| workflow example | 66% | 56% | best reads, worst output |
| backtick readFile call | 11-22% | 55-78% | variable |
| current (no backticks + output instruction) | 11% | 78% | stable but low reads |

## the core tension

the skill needs to teach a *behavior* (check schema before translating) but can't embed the *data* (specific field types) because types vary by dataset.

teaching behavior requires examples. examples get copied into output.

- workflow example showing "read schema → see status is string → apply toint()" drove 66% schema reads
- but model copied backticks and explanatory text into APL output, causing parse errors
- removing copyable artifacts dropped schema-read back to ~11%

## why examples pollute output

the skill uses backticks throughout for syntax examples:

```markdown
| `stats` | `summarize` | Different aggregation syntax |
```

model sometimes copies these into APL:
- "invalid input text `perc50`, `perc9..."
- "invalid input text `sample-http-log..."

this happens even without schema-read instruction backticks.

## design principles that apply

from [agent skill design principles](/Users/bdsqqq/commonplace/01_files/2026-01-15%20agent%20skill%20design%20principles%20--%20type__reference%20source__agent%20area__work.md):

**"explicit vocabularies over references"** — skills that say "read X for details" without embedding critical constraints risk agents never following the link. but we CAN'T embed here because data is dynamic.

**"examples are load-bearing for pattern-matching skills"** — spl-to-apl is pattern-matching. examples drive behavior. but examples also get copied.

## what the 2 failing cases need

both failures are type comparison errors:
- `status >= 500` does string comparison when status is string type
- fix requires `toint(status) >= 500`

model knows about toint() (mentioned in skill). doesn't consistently know WHEN to apply it without reading schema.

## solution

**embed the heuristic directly.** changed instruction from "read schema to check types" to:

> **Type safety:** Fields like "status" are often stored as strings. Always cast before numeric comparison: toint(status) >= 500, not status >= 500.

result: **100% results-match** (stable across multiple runs).

the insight: we couldn't embed dataset-specific types, but we COULD embed a defensive heuristic that works universally. "always cast" is safer than "check schema then maybe cast".

## files changed

- `skills/spl-to-apl/SKILL.md` — added schema-read instruction and output format guidance
- `skills/spl-to-apl/.meta/spl-to-apl.eval.ts` — added dotenv loading for local runs
- `skills/spl-to-apl/.meta/DESIGN-NOTES.md` — detailed iteration log
- `eval-tooling/.env.example` — added AXIOM_PLAY_* vars
- `eval-tooling/package.json` — added dotenv dependency
