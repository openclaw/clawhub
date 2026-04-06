---
module: narrative-structure
category: writing-quality
dependencies: []
estimated_tokens: 450
---

# Narrative Structure

Templates and patterns for turning a session brief into a post.

## Post Formats

### Blog Post (default)

Best for: dev blogs, company engineering blogs, personal sites.

```markdown
# [Verb]ing [What] [With/In/Using What]

[2-3 sentence opener. State what was done and the headline result.
No "In this post we will..." — just say the thing.]

## Where We Started

[Concrete starting state. Numbers, not adjectives.
"A 150K-line C codebase" not "a large legacy codebase."]

## What We Built

### [Phase/Decision 1 name]

[What and why. 2-4 sentences. Code snippet only if it
illustrates a technique worth sharing.]

### [Phase/Decision 2 name]

[Same pattern. Focus on the interesting parts — skip
anything a reader could guess.]

![Terminal recording of tests passing](assets/tests.gif)

## How We Verified It

[Show the proof. Test output, before/after measurements,
screenshots. This is where recordings from scry belong.]

![Browser recording of the running app](assets/demo.gif)

## Results

| Metric | Before | After |
|--------|--------|-------|
| Lines of code | 0 | 10,950 |
| Tests passing | 0 | 180 |
| Build target | Emscripten | wasm-pack |

## What's Left

[Honest list. Readers respect knowing what isn't done.]

- [ ] Remaining item 1
- [ ] Remaining item 2
```

### Case Study

Best for: marketing, demonstrating tool capability to prospects.

```markdown
# [Outcome]: [How]

## The Challenge

[1 paragraph. What problem needed solving and why it was hard.]

## The Approach

[Walk through the method. Emphasize decisions, not steps.
Show how the tool/technique enabled the outcome.]

## The Evidence

[Hard numbers. Before/after. Screenshots and recordings.]

## Key Takeaways

1. [Insight that generalizes beyond this project]
2. [Insight about the tool or technique]
3. [What would change if doing it again]
```

### Social Thread

Best for: Twitter/X, Bluesky, LinkedIn.

```
1/ [Hook: the result in one sentence]

2/ Starting point: [concrete state before]

3/ The approach: [key technique in 1-2 sentences]

4/ [The interesting part — a decision, a pivot, a surprise]

5/ Results: [numbers]

6/ What's next: [honest assessment]

[Attach: GIF from scry recording, screenshot of output]
```

## Writing Rules

1. **Lead with the result**, not the process
2. **One number per section** minimum — ground every claim
3. **Show, don't summarize** — a GIF of tests passing says more
   than "we wrote comprehensive tests"
4. **Name the tools** — readers want to know how, not just what
5. **Include a pivot** — straight-line success stories aren't
   believable or interesting
6. **End with honesty** — what's unfinished, what you'd change

## Title Patterns That Work

- `[Verb]ing [Big Thing] in [Constraint]`
  — "Porting a Game Engine to Rust in One Session"
- `How We [Achieved Result] with [Tool/Technique]`
  — "How We Hit 180 Tests in 3 Hours with Parallel Agents"
- `[Number] [Things] I Learned [Doing X]`
  — "5 Things I Learned Rewriting C as Rust for WebAssembly"
- `From [State A] to [State B]: [How]`
  — "From Empty Repo to Playable Game: A Claude Code Session"

## Anti-Patterns

- "In this blog post, we will explore..." — skip the preamble
- "It's worth noting that..." — if it's worth noting, just note it
- Listing every file changed — nobody cares about the full diff
- Explaining things the audience already knows
- Screenshots of code when a link to the repo would do
- Claiming something works without showing evidence
