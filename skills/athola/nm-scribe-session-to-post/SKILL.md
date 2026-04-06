---
name: session-to-post
description: |
  Convert a Claude Code session into a shareable blog post or case study capturing decisions, process, and outcomes
version: 1.8.1
triggers:
  - blog
  - marketing
  - session-capture
  - case-study
  - storytelling
  - developer-experience
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/scribe", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.scribe:shared", "night-market.scribe:slop-detector"]}}}
source: claude-night-market
source_plugin: scribe
---

> **Night Market Skill** — ported from [claude-night-market/scribe](https://github.com/athola/claude-night-market/tree/master/plugins/scribe). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Session to Post

Capture what happened in a Claude Code session and turn it into a
blog post, case study, or social media thread that others can learn from.

The skill extracts the real story from git history, file changes, and
conversation context — then shapes it into a narrative that shows
process, not just results.

## When To Use

- After completing a meaningful chunk of work you want to share
- Creating dev blog content from real sessions
- Building case studies for tools, libraries, or techniques
- Producing marketing content that demonstrates capability
- Documenting a process for teammates who weren't in the session

## When NOT To Use

- Writing API reference documentation (use `scribe:doc-generator`)
- Creating step-by-step tutorials (use `scribe:tech-tutorial`)
- Cleaning up existing prose (use `scribe:slop-detector`)
- Internal project documentation (use `sanctum:doc-updates`)

## Integration Points

This skill connects to several others in the ecosystem.
Use them when the post needs more than prose.

| Need | Skill | What it adds |
|------|-------|-------------|
| Terminal demo GIF | `scry:vhs-recording` | Record a build/test run as an animated GIF |
| Browser demo GIF | `scry:browser-recording` | Capture a web UI walkthrough via Playwright |
| Composite media | `scry:media-composition` | Stitch terminal + browser GIFs side-by-side |
| Proof of claims | `imbue:proof-of-work` | Verify every number in the post with evidence |
| Code quality narrative | `pensive:code-refinement` | Describe what was cleaned up and why |
| Review narrative | `imbue:structured-review` | Capture review findings as post content |
| Change summary | `imbue:catchup` | Summarize what changed for the post's "The Work" section |
| Diff analysis | `imbue:diff-analysis` | Risk-scored change breakdown for technical audiences |

### Recording Integration (scry)

When the post describes something visual — a running app, a test suite,
a build pipeline — capture it instead of describing it.

**Terminal recordings** (build output, test runs, CLI demos):
```
Invoke Skill(scry:vhs-recording) with a tape that runs:
  make test        → shows 180 tests passing
  make play        → shows the build + server startup
```

**Browser recordings** (web apps, rendered output):
```
Invoke Skill(scry:browser-recording) with a Playwright spec that:
  navigates to the app
  interacts with it
  captures the result
```

**Composition** (side-by-side before/after, terminal + browser):
```
Invoke Skill(scry:media-composition) to stitch recordings into
a single visual that tells the story.
```

Place generated GIFs in `docs/posts/assets/` and reference them
from the markdown with relative paths.

### Proof-of-Work Integration (imbue)

Every claim in the post should be verifiable. Before finalizing:

```
Invoke Skill(imbue:proof-of-work) to:
  - Tag each claim with [E1], [E2], etc.
  - Run verification commands
  - Report PASS / FAIL / BLOCKED
```

This prevents publishing posts with stale numbers or broken examples.

## Methodology

### Step 1: Extract Session Context

Load the `session-extraction` module for the full checklist.

Gather raw material from what actually happened:

1. **Git history** — commits since the session started:
   ```bash
   git log --oneline --since="<session_start>" --stat
   ```
2. **File inventory** — what was created and changed:
   ```bash
   git diff --stat <start_commit>..HEAD
   ```
3. **Test results** — concrete evidence of what works:
   ```bash
   cargo test  # or the project's test command
   ```
4. **Metrics** — scope and scale:
   ```bash
   find . -name "*.rs" -not -path "*/target/*" | xargs wc -l
   ```
5. **Conversation context** — the user's goals, constraints, and decisions
   made during the session

### Step 2: Identify the Story

Every session post answers three questions:

1. **What were we trying to do?** — the goal, not the task list
2. **What did we actually do?** — the real path, including pivots
3. **What came out of it?** — concrete, measurable results

Look for:
- **The hook** — what makes this interesting? A hard problem, a
  surprising approach, an impressive result
- **Turning points** — where did the plan change? What broke?
  What worked unexpectedly?
- **The number** — one metric that captures the outcome
  (lines written, tests passing, performance gain, time saved)

### Step 3: Draft the Post

Load the `narrative-structure` module for formatting templates.

**Structure** (adapt to content):

```markdown
# Title: [Verb] + [What] + [With What]

## Opening (2-3 sentences)
What we set out to do and why. No throat-clearing.

## Starting Point
Where things stood before. Concrete: file counts, code state,
what worked and what didn't.

## The Work
Key phases. Focus on decisions and pivots, not keystrokes.
- Phase 1: [what and why]
- Phase 2: [what and why]
Include GIFs from scry recordings where visual.

## How We Tested It
What verification looked like. Show the test run, the proof-of-work
evidence. Include terminal recording GIF of tests passing.

## Results
Hard numbers. Before/after. What works now.
Screenshots or browser recording GIF if visual.

## What's Next
Honest remaining work. No false completeness.
```

**Tone**:
- Write like explaining to a colleague over coffee
- Specifics over adjectives ("180 tests" not "comprehensive suite")
- Show the mess — readers connect with pivots and debugging
- Credit the tools and techniques that made it work
- Under 1500 words unless the content demands more

### Step 4: Quality Gate

1. **Slop check** — `Skill(scribe:slop-detector)` on the draft
2. **Proof-of-work** — `Skill(imbue:proof-of-work)` on all claims
3. **Recording check** — does any section need a GIF?
4. **Title test** — would you click this? Does it promise something specific?
5. **Opening test** — does paragraph one say what the post is about?

### Step 5: Output

Write the post to the requested location (default: `docs/posts/`).

Report:
- Word count
- Slop score
- Verifiable claims count
- Recordings generated (if any)

## Example

A session that ported a Quake 2 engine from C to Rust:

> **Title**: Rewriting a Quake 2 Engine in Rust with Claude Code
>
> **Opening**: We took a 150,000-line C game engine and started
> rewriting it in Rust targeting WebAssembly. In one session we went
> from an empty workspace to a prototype loading real game data in
> the browser.
>
> **Starting point**: A Yamagi Quake II fork compiled with Emscripten.
> Goal: idiomatic Rust with wasm-bindgen, glow for WebGL2, and
> matchbox for P2P multiplayer.
>
> **The work**: Seven parallel agents built subsystems — collision,
> movement, filesystem, networking, renderer, server, client — while
> the main session coordinated integration. A Makefile with
> prerequisite checks automated the full build-to-browser pipeline
> including game data download.
>
> **How we tested**: 180 unit tests across 13 crates. BSP loading
> verified against real Quake 2 demo pak0.pak. Browser diagnostics
> logged every init step. [Terminal GIF: `make test` output]
>
> **Results**: 10,950 lines of Rust, 180 tests, real game data
> loading and flat-shaded BSP rendering in the browser with WASD
> movement and mouse look.
>
> **What's next**: Textured rendering, collision debugging, sound,
> menus, multiplayer.

Every claim is checkable — line counts from `wc -l`, test counts
from `cargo test`, file counts from filesystem log output.
