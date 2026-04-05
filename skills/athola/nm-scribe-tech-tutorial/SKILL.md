---
name: tech-tutorial
description: Plan, draft, and refine technical tutorials for developers
version: 1.8.1
triggers:
  - tutorial
  - technical-writing
  - code-examples
  - developer-docs
  - getting-started
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/scribe", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.scribe:shared", "night-market.scribe:slop-detector"]}}}
source: claude-night-market
source_plugin: scribe
---

> **Night Market Skill** — ported from [claude-night-market/scribe](https://github.com/athola/claude-night-market/tree/master/plugins/scribe). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Tech Tutorial

A good technical tutorial has one goal: move a reader from not knowing
how to do something to being able to do it.
That requires working code, concrete steps, and honest acknowledgment
of where things go wrong.
This skill guides you through outlining, drafting, and verifying a
tutorial that meets that standard.

## When To Use

- Writing a getting-started guide for a library, CLI tool, or API
- Creating a step-by-step walkthrough that readers follow at a terminal
- Explaining a technical concept through a hands-on exercise
- Producing a how-to that complements API reference documentation

## When NOT To Use

- Generating API reference docs (use `scribe:doc-generator`)
- Cleaning up existing prose (use `scribe:slop-detector`)
- Producing high-level architecture overviews without runnable steps
- Writing conceptual essays without hands-on components

## Methodology

### Step 1: Scope and Audience

Before writing a single line, answer these questions:

- Who is this for? (experience level, assumed prior knowledge)
- What will they build or accomplish by the end?
- What is the single prerequisite the reader must have installed?
- What is explicitly out of scope?

Write these answers down as a header block in the draft.
If you cannot answer the "what will they accomplish" question
in one sentence, the scope is too broad.

### Step 2: Outline

Load: `@modules/outline-structure.md`

Produce a section-by-section outline before drafting prose.
Each section entry must include a one-line description of what
the reader does or learns in that section.
See the outline module for the standard section order and
length targets per section type.

### Step 3: Draft Code Examples First

Load: `@modules/code-examples.md`

Write the code before the prose.
Each snippet must run against a real environment before it
appears in the tutorial.
Annotate only the non-obvious lines.
See the code examples module for formatting and error-handling rules.

### Step 4: Draft Prose Around the Code

Prose exists to explain what the code does and why.
Follow these rules:

- One paragraph per step: what to run, what it does, what to expect
- State the expected output after each command block
- Use second person ("you") consistently throughout
- Do not narrate what the reader will do next; just present the next step

### Step 5: Build Complexity Gradually

Load: `@modules/progressive-complexity.md`

Start with the minimal working example.
Introduce variations and edge cases only after the baseline works.
See the progressive complexity module for the layering rules
and pacing guidance.

### Step 6: Slop Check

After drafting, run:

```
Skill(scribe:slop-detector)
```

Fix all tier-1 findings before proceeding.
Pay particular attention to:

- Tier-1 vocabulary slop (see `scribe:slop-detector` word lists)
- Tricolon adjective clusters ("fast, efficient, and reliable")
- Participial tail-loading (sentences ending with ", enabling ...")

### Step 7: Quality Gate

Verify the completed tutorial against this checklist:

- [ ] All code blocks tested and produce the stated output
- [ ] Prerequisites section lists exact versions where relevant
- [ ] Every step states the expected result
- [ ] Troubleshooting section covers at least two common failure modes
- [ ] No tier-1 slop words
- [ ] Em dash count is under 2 per 1000 words
- [ ] Bullet ratio is under 40%
- [ ] Line length wraps at 80 characters

## Required TodoWrite Items

1. `tech-tutorial:scope-defined` - Audience, goal, and out-of-scope noted
2. `tech-tutorial:outline-approved` - Section outline confirmed
3. `tech-tutorial:code-tested` - All snippets verified against a real env
4. `tech-tutorial:prose-drafted` - Walkthrough text written
5. `tech-tutorial:slop-scanned` - Slop detector passed
6. `tech-tutorial:quality-verified` - Quality gate checklist cleared
7. `tech-tutorial:user-approved` - Final approval received

## Module Reference

- See `modules/outline-structure.md` for section order and length targets
- See `modules/code-examples.md` for snippet formatting and annotation rules
- See `modules/progressive-complexity.md` for pacing and layering guidance

## Integration with Other Skills

| Skill | When to Use |
|-------|-------------|
| scribe:slop-detector | After drafting, before approval |
| scribe:doc-generator | For companion API reference sections |
| scribe:style-learner | To match an existing tutorial voice |

## Exit Criteria

- Tutorial outline confirmed before drafting begins
- All code snippets tested in a real environment
- Slop score below 1.5 (clean)
- Quality gate checklist passed
- User approval received
