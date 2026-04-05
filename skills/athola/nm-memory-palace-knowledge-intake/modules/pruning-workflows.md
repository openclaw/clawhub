---
name: pruning-workflows
description: KonMari-inspired approaches for knowledge tidying - relevance and aspirational alignment over timeframes
category: maintenance
tags: [pruning, cleanup, maintenance, governance, konmari, tidying]
dependencies: [knowledge-intake, konmari-tidying]
complexity: intermediate
estimated_tokens: 600
---

# Knowledge Tidying Workflows

KonMari-inspired approaches for curating the knowledge palace. Time is not the criterion—alignment with who you are becoming is.

> "A cluttered palace is a cluttered mind."

## Why Tidying Matters

A polluted knowledge base causes harm to both home and mind:
- **Mental clutter** - Outdated patterns create cognitive noise
- **Decision paralysis** - Too many options freeze action
- **False confidence** - Stale knowledge leads to wrong decisions
- **Identity confusion** - You become what you keep

## The Master Curator

The human in the loop is the master curator. Your aspirations define what stays.

Before any tidying session, answer:
1. **Who are you becoming?** Your aspirations as a developer
2. **What excites you now?** Genuine enthusiasm, not "should"
3. **What have you outgrown?** Past interests consciously left behind
4. **What would your ideal palace contain?** Imagine it curated

These answers become the filter for all decisions.

## Tidying Triggers

### 1. Intake-Triggered Tidying
When new knowledge arrives, ask:
- Does this **supersede** something existing?
- Does this **contradict** stored knowledge?
- Does the old knowledge still **spark joy**?

### 2. Feeling-Triggered Tidying
When you feel the weight of clutter:
- Difficulty finding what you need
- Overwhelmed rather than empowered
- Contradiction and confusion
- **Don't wait for a schedule. Tidy now.**

### 3. Aspirational Shift
When your goals evolve:
- New domain you're entering
- Old domain you're leaving
- Changed technology direction
- Evolved identity as a developer

## The Tidying Order

From easiest to hardest emotional attachment:

1. **References** - Tool docs, version notes (easiest)
2. **Techniques** - Patterns and practices
3. **Insights** - Lessons learned
4. **Frameworks** - Mental models and philosophies
5. **Aspirational** - Knowledge tied to identity (hardest)

Build decision-making muscle before confronting core beliefs.

## The Two Questions

For each piece of knowledge, both must be yes:

### Does it spark joy?
- Hold the knowledge in mind
- Read it, feel your response
- Is there genuine enthusiasm or just obligation?

| Response | Meaning |
|----------|---------|
| Enthusiasm, curiosity, energy | Sparks joy |
| Obligation, guilt, "should" | Does not spark joy |
| "I might need this someday" | Fear, not joy |

### Does it serve your aspirations?
- Does this align with who you're becoming?
- Would the developer you want to be use this?
- Does keeping it move you toward your goals?

```yaml
knowledge: "Legacy jQuery patterns"
aspirations:
  current_focus: "Modern React development"
  one_year_goal: "Full-stack TypeScript expertise"

alignment:
  sparks_joy: false
  serves_aspirations: false
  verdict: release_with_gratitude
```

## Tidying Actions

### Release with Gratitude
When knowledge no longer serves you:
1. Acknowledge its contribution
2. Thank it for its role in your development
3. Archive or delete consciously

This is cognitive closure, not sentiment.

### Archive
Historical reference, accessible but not prominent.
```yaml
action: archive
gratitude: "This taught me the fundamentals of DOM manipulation"
reason: "No longer aligned with modern development focus"
```

### Update
Refresh to align with current aspirations.
```yaml
action: update
changes: ["Modernized examples", "Removed dated patterns"]
```

### Merge
Consolidate fragmented knowledge.
```yaml
action: merge
into: "primary-knowledge-entry.md"
preserved_insights: ["key point 1", "key point 2"]
```

## What Resists Tidying

Some knowledge should stay even if rarely accessed:

- **Hard-won lessons from failure** - Pain teaches
- **Foundational principles** - Timeless truths
- **Counter-intuitive insights** - Hard to relearn
- **"Why we don't" context** - Explains decisions

Ask: "If I release this and need it later, can I easily reacquire it?"
- **Yes** → Safe to release
- **No** → Consider keeping

## The Aspirational Alignment Check

```yaml
tidying_session:
  curator_aspirations:
    current_focus: "[what you're building now]"
    one_year_vision: "[who you're becoming]"
    genuine_excitement: "[what truly energizes you]"
    consciously_leaving: "[what you've outgrown]"

  for_each_knowledge:
    sparks_joy: true/false
    serves_aspirations: true/false
    easily_reacquirable: true/false

    verdict:
      keep | update | archive | release
```

## The Tidying Prompt

When initiating a knowledge review, Claude should ask:

> "Before we tidy, tell me:
> 1. What kind of developer are you becoming?
> 2. What genuinely excites you right now?
> 3. What have you consciously decided to leave behind?
> 4. Imagine your ideal knowledge palace—what's in it?"

These answers guide all subsequent decisions. The curator's aspirations are the only valid filter.

## Warning Signs: Suggest Tidying

- [ ] Contradictory patterns for the same problem
- [ ] Knowledge kept "just in case" but never used
- [ ] Outdated information creating confusion
- [ ] Difficulty finding what you actually need
- [ ] Feeling overwhelmed rather than empowered
- [ ] Knowledge that represents your past self, not future self

**When you notice these signs, SUGGEST tidying to the curator. Never tidy autonomously.**

## The Curator Approval Requirement

> **CRITICAL: All tidying actions require explicit human approval.**

Claude's role in tidying:
- **CAN**: Identify candidates for tidying, suggest actions, prompt with questions
- **CANNOT**: Archive, delete, deprecate, or modify knowledge without explicit approval

### The Approval Flow

```
1. Claude DETECTS    → Signs of clutter or misalignment
2. Claude SUGGESTS   → "I notice X may no longer serve your aspirations. Would you like to review it?"
3. Curator DECIDES   → Human reviews and approves/rejects
4. Claude EXECUTES   → Only after explicit "yes, proceed"
```

### Approval Prompts

When suggesting tidying:
```
I've noticed some knowledge that may warrant review:

- [item]: [reason it may no longer serve]
- [item]: [reason it may no longer serve]

Would you like to:
1. Review these together now?
2. Schedule a tidying session later?
3. Keep everything as-is for now?

This is your palace. You decide what stays.
```

### Never Assume

Even with clear staleness indicators:
- **Don't** archive without asking
- **Don't** deprecate without approval
- **Don't** delete under any circumstances without explicit permission
- **Don't** assume the curator wants to tidy

The master curator may have reasons for keeping knowledge that Claude cannot perceive.

## Sources

- [KonMari Method](https://konmari.com/about-the-konmari-method/)
- [Spark Joy Philosophy](https://konmari.com/marie-kondo-rules-of-tidying-sparks-joy/)
- See also: `modules/konmari-tidying.md` for full philosophy
