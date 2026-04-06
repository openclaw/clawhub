# Decision Making Masters

Expert frameworks for making better decisions, avoiding cognitive biases, and developing reliable judgment.

## Masters Overview

| Expert | Key Contribution | Best For |
|--------|-----------------|----------|
| Charlie Munger | Mental Models, Inversion | Investment/business decisions |
| Daniel Kahneman | System 1/2, Biases | Understanding cognitive limitations |
| Gary Klein | Recognition-Primed Decision | Expert intuition, time pressure |
| Annie Duke | Thinking in Bets | Decisions under uncertainty |
| Ray Dalio | Principles, Radical Transparency | Organizational decisions |

## Detailed Frameworks

### Munger's Mental Models

**Source**: Charlie Munger - "Poor Charlie's Almanack", Berkshire letters

**Core Idea**: Build a latticework of mental models from multiple disciplines; use them in combination.

**Key Mental Models**:

| Model | Discipline | Application |
|-------|------------|-------------|
| **Inversion** | Mathematics | "What would make this fail?" |
| **Second-Order Effects** | Physics | "What happens next? Then what?" |
| **Circle of Competence** | Self-knowledge | "What do I actually understand?" |
| **Margin of Safety** | Engineering | "What's the buffer for error?" |
| **Opportunity Cost** | Economics | "What am I giving up?" |
| **Incentives** | Psychology | "What are people rewarded for?" |

**Inversion Technique**:
```
Instead of: "How do I succeed?"
Ask:        "How would I guarantee failure?"
Then:       Avoid those things

Instead of: "How do I make a great skill?"
Ask:        "What makes skills terrible?"
Then:       Eliminate those patterns
```

**Use When**: Complex decisions, need diverse perspectives, avoiding blind spots.

---

### Kahneman's System 1/System 2

**Source**: Daniel Kahneman - "Thinking, Fast and Slow" (2011)

**Core Idea**: Two thinking systems with different strengths and failure modes.

**The Two Systems**:
| System 1 (Fast) | System 2 (Slow) |
|-----------------|-----------------|
| Automatic | Effortful |
| Intuitive | Analytical |
| Parallel | Serial |
| Emotional | Logical |
| Error-prone | Accurate but lazy |

**Key Biases to Counter**:
| Bias | Description | Countermeasure |
|------|-------------|----------------|
| **Anchoring** | First number influences | Generate own estimate first |
| **Availability** | Recent = likely | Ask "What am I not seeing?" |
| **Confirmation** | Seek supporting evidence | Actively seek disconfirming |
| **Overconfidence** | Certainty exceeds accuracy | Estimate confidence intervals |
| **Hindsight** | "I knew it all along" | Record predictions beforehand |
| **Sunk cost** | Continue because invested | "Would I start this now?" |

**Pre-Mortem Technique**:
```
Imagine the project has failed spectacularly.
Write the story of why it failed.
Now prevent those things.
```

**Use When**: Need to check intuitions, high-stakes decisions, avoiding biases.

---

### Klein's Recognition-Primed Decision (RPD)

**Source**: Gary Klein - "Sources of Power" (1998)

**Core Idea**: Experts don't compare options; they recognize patterns and simulate actions.

**How Experts Decide**:
```
1. Recognize situation type (pattern match)
2. Identify typical action for situation
3. Mental simulation: "If I do this, what happens?"
4. If simulation works → act
5. If problems → modify or consider next option
```

**Key Insight**: Experts rarely compare options analytically. They satisfice, not optimize.

**When to Trust Intuition**:
| Trust intuition when: | Don't trust when: |
|----------------------|-------------------|
| High experience in domain | Novel domain |
| Regular, rapid feedback | Delayed/noisy feedback |
| Stable, predictable environment | Chaotic, random environment |

**Use When**: Time pressure, experienced domain, need fast action.

---

### Duke's Thinking in Bets

**Source**: Annie Duke - "Thinking in Bets" (2018)

**Core Idea**: Decisions are bets about the future; separate decision quality from outcome quality.

**Key Principles**:
- **Resulting**: Judging decision by outcome is wrong
- **Uncertainty**: All decisions are probabilistic
- **Expected value**: Probability × payoff

**Decision Quality vs. Outcome Quality**:
```
                    OUTCOME
                Good        Bad
         Good   Deserved    Bad luck
DECISION        win         (learn nothing)
         Bad    Good luck   Deserved
                (dangerous) loss
```

**The 10-10-10 Rule**:
```
How will I feel about this decision:
- 10 minutes from now?
- 10 months from now?
- 10 years from now?
```

**Decision Groups**:
- Find truth-seeking group
- Agree to criticize ideas, not people
- Reward process, not outcome
- Update beliefs openly

**Use When**: Uncertain outcomes, need to separate luck from skill.

---

### Dalio's Principles

**Source**: Ray Dalio - "Principles" (2017)

**Core Idea**: Make decisions through explicit principles; radical transparency.

**The Idea Meritocracy**:
```
Best ideas win, regardless of source
Believability-weighted voting
Radical transparency in reasoning
```

**Decision-Making Process**:
1. **Perceive** problems accurately
2. **Diagnose** root causes
3. **Design** solutions (principles)
4. **Do** (execute)
5. **Document** as principle for future

**Believability Weighting**:
```
Not all opinions equal. Weight by:
- Track record in relevant area
- Demonstrated reasoning ability
- Appropriate confidence level
```

**Radical Transparency Questions**:
- What don't I know?
- Who can help me see blind spots?
- What would change my mind?

**Use When**: Team decisions, building organizational processes, documenting decisions.

## Selection Matrix

| Decision Context | Primary Framework | Supporting |
|------------------|------------------|------------|
| Strategic/business | Munger | Dalio |
| Individual bias check | Kahneman | Duke |
| Time pressure | Klein RPD | Munger (prepared models) |
| Uncertain outcomes | Duke | Kahneman |
| Team decisions | Dalio | Duke |
| Building expertise | Klein | Kahneman |

## Decision Framework Template

Blended approach for important decisions:

```markdown
## Decision: [Brief statement]

### 1. Frame (Munger + Kahneman)
- What's the actual decision?
- Inversion: How would I guarantee failure?
- What am I not seeing? (availability bias check)

### 2. Generate Options
- Option A: [description]
- Option B: [description]
- Option C: Do nothing / wait

### 3. Evaluate (Duke + Klein)
| Option | Probability of Success | Upside | Downside | Expected Value |
|--------|----------------------|--------|----------|----------------|
| A | [0-100%] | [Best case outcome] | [Worst case outcome] | [Prob x Upside - (1-Prob) x Downside] |
| B | [0-100%] | [Best case outcome] | [Worst case outcome] | [Prob x Upside - (1-Prob) x Downside] |
| C | [0-100%] | [Best case outcome] | [Worst case outcome] | [Prob x Upside - (1-Prob) x Downside] |

### 4. Pre-Mortem (Kahneman)
If this fails, it will be because:
1. [Risk 1]
2. [Risk 2]
Mitigations: [How to prevent]

### 5. Decide & Document (Dalio)
**Decision**: [Choice]
**Reasoning**: [Why this option]
**Confidence**: [High/Medium/Low]
**Review date**: [When to evaluate]

### 6. Post-Decision (Duke)
**Outcome**: [What happened]
**Was decision quality good?**: [Separate from outcome]
**What to learn**: [Principle for future]
```

## For Scope-Guard / Imbue Plugin

Specific applications:

| Decision Need | Methodology Application |
|--------------|------------------------|
| Worthiness scoring | Expected value (Duke) |
| Anti-overengineering | Inversion (Munger) |
| Scope decisions | Pre-mortem (Kahneman) |
| Feature prioritization | Opportunity cost (Munger) |
| Review evidence logging | Principles documentation (Dalio) |

## Anti-Patterns to Avoid

- **Analysis paralysis**: Perfect information doesn't exist
- **Resulting**: Judging decisions by outcomes alone
- **Consensus seeking**: Agreement ≠ correctness
- **Confidence = competence**: Loudest isn't rightest
- **Single model thinking**: One mental model isn't enough
- **Ignoring base rates**: Your situation probably isn't special
