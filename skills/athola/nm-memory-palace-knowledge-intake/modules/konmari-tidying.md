---
name: konmari-tidying
description: Marie Kondo's KonMari philosophy adapted for knowledge curation - relevance, joy, and aspirational alignment over arbitrary timeframes
category: philosophy
tags: [konmari, tidying, curation, philosophy, joy, relevance]
dependencies: [knowledge-intake]
complexity: intermediate
estimated_tokens: 700
source: https://konmari.com/about-the-konmari-method/
---

# KonMari Tidying for Knowledge

Marie Kondo's philosophy adapted for knowledge curation. Time-based pruning is lazy governance. True tidying asks deeper questions: Does this knowledge still serve who you are becoming?

## The Core Shift

> "The question of what you want to own is actually the question of how you want to live your life."
> — Marie Kondo

Traditional pruning: "Delete if not accessed in 90 days"
KonMari pruning: "Does this knowledge spark joy and serve your aspirations?"

**Time is not the criterion. Alignment is.**

## Why This Matters for Code and Knowledge

A convoluted, polluted codebase causes harm to both home and mind:
- **Mental clutter** - Outdated patterns create cognitive noise
- **Decision fatigue** - Too many options paralyze action
- **False confidence** - Stale knowledge leads to wrong decisions
- **Lost identity** - You become what you keep, not what you accumulate

The memory palace is your intellectual home. Clutter in the palace is clutter in the mind.

## The Six Rules Adapted

### 1. Commit to Tidying
Don't half-tidy. When you begin a knowledge review, complete it. Partial cleanup leaves worse mess than none.

### 2. Imagine Your Ideal Developer Life
Before pruning, ask: **Who am I becoming?**
- What kind of developer do I want to be in 1 year?
- What domains genuinely excite me?
- What have I outgrown?

Your aspirations define what stays.

### 3. Finish Discarding First
Don't reorganize before releasing. Moving cluttered knowledge to new locations is not tidying—it's hiding.

### 4. Tidy by Category, Not Location
Review all knowledge of one type together:
- All architecture patterns at once
- All tool references at once
- All learning resources at once

This reveals true scope and redundancy.

### 5. Follow the Right Order
From easiest to hardest emotional attachment:

1. **References** - Tool docs, version notes (easiest to release)
2. **Techniques** - Patterns and practices
3. **Insights** - Lessons learned
4. **Frameworks** - Mental models and philosophies
5. **Aspirational** - Knowledge tied to identity (hardest)

Build decision-making muscle before confronting core beliefs.

### 6. Ask: Does It Spark Joy AND Serve Your Aspirations?

Two questions, both must be yes:

**Does this spark joy?**
- Pick up the knowledge (read it, hold it in mind)
- Do you feel "a little thrill, as if cells in your body are slowly rising"?
- Is there genuine enthusiasm, or just obligation?

**Does this serve your aspirations?**
- Does this align with who you're becoming?
- Would the developer you want to be use this?
- Does keeping it move you toward your goals?

## The Curator's Prerogative

The human in the loop is the master curator. Your aspirations, your goals, your vision of the future—these define relevance, not arbitrary metrics.

**Only you can answer:**
- What domains are you growing into?
- What have you consciously decided to leave behind?
- What knowledge represents your past self, not your future self?

Claude can prompt these questions. Claude cannot answer them for you.

## The Joy Test for Knowledge

Hold the knowledge in your mind. Read a summary. Then feel:

| Response | Meaning | Action |
|----------|---------|--------|
| Enthusiasm, curiosity, energy | Sparks joy | Keep |
| Obligation, guilt, "should" | Does not spark joy | Release |
| Neutral, no response | Test again | Revisit with aspirational lens |

**"I might need this someday"** is not joy. It's fear. Release with gratitude.

## Releasing with Gratitude

When knowledge no longer serves you:

1. **Acknowledge its contribution** - "This pattern served me when I was learning X"
2. **Thank it** - Recognize its role in your development
3. **Release it** - Archive or delete, but consciously let go

This is not woo-woo sentiment. It's cognitive closure. Unprocessed releases create mental residue.

## The Aspirational Alignment Check

For each piece of knowledge, map against your stated goals:

```yaml
knowledge: "Legacy jQuery patterns"
aspirations:
  current_focus: "Modern React development"
  one_year_goal: "Full-stack TypeScript expertise"
  excitement: "Real-time collaborative apps"

alignment_check:
  serves_current_focus: false
  serves_one_year_goal: false
  sparks_genuine_excitement: false
  verdict: release_with_gratitude
```

## When NOT to Release

Some knowledge resists tidying for good reason:

- **Hard-won lessons from failure** - Pain teaches; don't repeat it
- **Foundational principles** - Timeless truths transcend trends
- **Counter-intuitive insights** - Easy to forget, hard to relearn
- **Context for decisions** - "Why we DON'T do X" has value

Ask: "If I release this and need it later, can I easily reacquire it?"
- Yes → Safe to release
- No → Consider keeping despite low current relevance

## The Tidying Prompt

When initiating a knowledge review, the curator should be asked:

1. **Who are you becoming?** Describe your aspirations as a developer.
2. **What excites you right now?** Not "should" - genuine excitement.
3. **What have you outgrown?** Past interests you've consciously left.
4. **What would your ideal knowledge palace contain?** Imagine it curated.

These answers become the filter for all subsequent decisions.

## The Polluted Codebase Warning

> A cluttered palace is a cluttered mind.

Signs your knowledge base needs KonMari tidying:
- Contradictory patterns for the same problem
- Knowledge you keep "just in case" but never use
- Outdated information creating confusion
- Difficulty finding what you actually need
- Feeling overwhelmed rather than empowered

**When you notice these signs, SUGGEST tidying. Never act without curator approval.**

## The Curator Approval Requirement

> **CRITICAL: The master curator (human) must approve ALL tidying actions.**

Claude's role:
- **CAN**: Detect signs of clutter, suggest reviews, prompt with questions, prepare options
- **CANNOT**: Archive, delete, deprecate, or modify knowledge autonomously

The approval flow:
```
Claude DETECTS  → Claude SUGGESTS  → Curator DECIDES  → Claude EXECUTES (only if approved)
```

This is not optional. The human's aspirations, context, and reasons may be invisible to Claude. What looks like clutter may serve purposes Claude cannot perceive.

**Your palace. Your rules. Your approval required.**

## Sources

- [About the KonMari Method](https://konmari.com/about-the-konmari-method/)
- [Rule 6: Ask Yourself If It Sparks Joy](https://konmari.com/marie-kondo-rules-of-tidying-sparks-joy/)
- [Why the KonMari Method Works](https://konmari.com/what-is-konmari-method/)
