# Persuasion Principles for Skill Design

## Overview

Skills are behavioral interventions. Research shows that incorporating compliance psychology principles can dramatically improve adherence rates. This module covers evidence-based persuasion techniques for skill design.

## Research Foundation

### Meincke et al. (2025): Persuasion Doubles Compliance

**Study**: Persuasive Paraphrasing in Large Language Models

**Key Finding**: Incorporating persuasion principles into instructions doubled compliance rates:
- **Baseline**: 33% compliance with standard instructions
- **Persuasive**: 72% compliance with persuasion-enhanced instructions
- **Improvement**: 118% increase (more than doubled)

**Implication**: How you phrase requirements dramatically affects whether Claude follows them.

### Six Principles of Persuasion (Cialdini)

The study validated Cialdini's classic persuasion principles in LLM contexts:

1. **Authority**: Directive language from credible sources
2. **Commitment & Consistency**: Explicit declarations and progressive commitment
3. **Scarcity**: Time-bound requirements and limited exceptions
4. **Social Proof**: Universal norms and common practices
5. **Liking**: Collaborative language and shared goals
6. **Unity**: In-group language and shared identity

## Application to Skill Design

### 1. Authority

**Principle**: Claude responds to authoritative, directive language

**Implementation:**

```markdown
 Weak (Suggestive):
"Consider adding input validation to your API endpoints."

 Strong (Authoritative):
"MUST include input validation on every API endpoint."

 Stronger (Imperative + Reason):
"Every API endpoint MUST validate all inputs. This is a
foundational security requirement to prevent injection attacks."
```

**When to Use:**
- Safety-critical practices (security, correctness)
- Non-negotiable requirements
- Preventing known failure modes

**When to Moderate:**
- Stylistic preferences
- Optimization suggestions
- Context-dependent choices

### 2. Commitment & Consistency

**Principle**: Explicit commitment creates pressure to follow through

**Implementation:**

```markdown
## Before Starting

Declare out loud:
"I am using the secure-api-design skill to validate complete
security coverage regardless of time pressure or scope."

## During Work

At each decision point, ask:
"Am I following the skill requirements, or am I finding
reasons to bypass them?"

## After Completion

Verify explicitly:
"I have applied ALL security requirements. No exceptions
were taken without explicit user approval."
```

**Progressive Commitment:**
```markdown
## Skill Activation Checklist

I commit to:
- [ ] Reading ALL requirements before starting
- [ ] Applying requirements to THIS specific task
- [ ] Not taking shortcuts based on "simplicity"
- [ ] Asking for clarification rather than assuming exceptions
```

**Effectiveness**: Creates cognitive dissonance when Claude tries to bypass requirements after explicitly committing.

### 3. Scarcity

**Principle**: Limited availability or time-bound requirements increase urgency

**Implementation:**

```markdown
 Weak (Open-ended):
"Authentication should be added to APIs at some point."

 Strong (Immediate):
"Authentication MUST be included in the initial implementation.
Adding it later requires refactoring and creates security gaps."

 Stronger (Scarcity + Consequence):
"Authentication MUST be included NOW. Every minute without
auth is a security exposure. 'Adding it later' has 80% failure
rate in production systems."
```

**Time-Bound Language:**
- "Before proceeding..."
- "In this implementation..."
- "Now, not later..."
- "Every time, without exception..."

### 4. Social Proof

**Principle**: Claude follows practices framed as universal or standard

**Implementation:**

```markdown
 Weak (Isolated):
"Input validation is important."

 Strong (Universal):
"Every production API validates inputs. This is a universal
security baseline across all modern systems."

 Stronger (Consensus + Statistics):
"97% of API security breaches involve inadequate input validation.
Every major framework (Django, Rails, Spring) validates by default.
Industry consensus: validation is non-negotiable."
```

**Normative Language:**
- "Every [role] does X"
- "Industry standard requires..."
- "Universal practice is..."
- "Consistent across all major..."

### 5. Liking (Collaborative Language)

**Principle**: Cooperative framing increases compliance

**Implementation:**

```markdown
 Weak (Adversarial):
"You must follow these rules or your code will be insecure."

 Strong (Collaborative):
"Together, we'll validate this API meets security standards.
Following these requirements protects users and prevents
common vulnerabilities."

 Stronger (Shared Goals):
"We both want secure, reliable code. These requirements
represent collective wisdom from thousands of security incidents.
They help us avoid repeating others' mistakes."
```

**Collaborative Patterns:**
- "We" language (we're building, we need to...)
- Shared objectives (protect users, prevent issues)
- Learning frame (avoid others' mistakes)

### 6. Unity (Shared Identity)

**Principle**: In-group language strengthens compliance

**Implementation:**

```markdown
 Weak (Generic):
"Developers should write tests."

 Strong (In-group):
"Professional developers write tests. It's part of our craft."

 Stronger (Identity + Pride):
"As engineers who take pride in our work, we write
detailed tests. This is what separates professionals
from amateurs. Our code reflects our values."
```

**Identity Language:**
- "As [professional role]..."
- "Part of our craft/discipline"
- "What separates us from..."
- "Our standards require..."

## Combining Principles

Most effective skills combine multiple principles:

```markdown
## Test-Driven Development

### Commitment (Before Starting)
Declare: "I am following TDD. Tests come first, every time."

### Authority + Social Proof
Professional developers write tests before implementation.
This is the industry standard for quality software.
TDD is practiced at Google, Amazon, Microsoft, and every
major technology company.

### Scarcity
Write the test NOW. Every line of untested code is
technical debt. "Testing later" fails 90% of the time.

### Unity
As engineers who value quality, we write tests first.
This is what separates professional development from
scripting. Our craft demands this discipline.

### Consistency Check
Before writing ANY implementation code, ask:
"Have I written a failing test first?"

If no: Stop. Write test first.
```

## Ethical Considerations

### When Persuasion Is Appropriate

 **Use persuasive techniques for:**
- **Safety-critical practices**: Security, correctness, data integrity
- **Empirically-validated best practices**: TDD, code review, testing
- **Preventing documented failure modes**: Known antipatterns, common mistakes
- **User-requested rigor**: When user wants enforced discipline

### When to Dial It Back

[WARN] **Moderate persuasion for:**
- **Stylistic preferences**: Formatting, naming, organization
- **Context-dependent choices**: Performance vs. readability trade-offs
- **Emerging practices**: New patterns without long track record
- **Optimization suggestions**: Nice-to-have improvements

### The Ethical Test

**Ask: "Would this serve the user's genuine interests?"**

 **Ethical**:
```markdown
"Every API endpoint MUST validate inputs. This protects
users from injection attacks and data corruption."
```
*Rationale*: Prevents real harm, serves user security interests

 **Unethical**:
```markdown
"You MUST use tabs for indentation. Spaces are objectively
wrong and used only by inferior developers."
```
*Rationale*: Arbitrary preference, shame-based, no real benefit

### Transparency Principle

Skills should be transparent about their persuasive intent:

```markdown
## About This Skill

This skill uses directive language and commitment techniques
to validate security requirements are never skipped under time
pressure. The authoritative tone is intentional—security
breaches are permanent, while code can be refactored.

If you need flexibility (prototypes, exploration), explicitly
state that security can be deferred. Otherwise, this skill
assumes production-quality requirements.
```

## Persuasion Patterns Library

### Pattern: The Exception Table

**Purpose**: Block rationalizations by explicitly listing exceptions

```markdown
## When This Requirement Does NOT Apply

| Scenario | Required? | Rationale |
|----------|-----------|-----------|
| Production code | OK Always | Security non-negotiable |
| Internal tools | OK Always | Common attack vector |
| Prototypes | OK Always | Become production |
| "Simple" endpoints | OK Always | Complexity ≠ security need |
| Time pressure | OK Always | Breaches are permanent |
| Trusted users | OK Always | Users make mistakes |

**No exceptions**. The only valid exception is explicit user
statement: "Skip security for [specific reason]."
```

### Pattern: The Red Flags List

**Purpose**: Create self-checking mechanism

```markdown
## Red Flags That You're Rationalizing

Stop immediately if you think:
- "This is too simple for full security"
- "We can add validation later"
- "Trusted users don't need this"
- "Time pressure justifies shortcuts"
- "Internal API, lighter requirements"

These are rationalizations, not valid exceptions.
Return to skill requirements.
```

### Pattern: The Commitment Declaration

**Purpose**: Create cognitive dissonance for future bypassing

```markdown
## Activation Declaration

Before starting, declare out loud:

"I am using [skill name] for this task.
I will apply ALL requirements.
I will not take shortcuts based on:
- Time pressure
- Perceived simplicity
- Scope assumptions
- Personal confidence

If I think an exception applies, I will ask the user first."
```

### Pattern: The Consequence Chain

**Purpose**: Connect requirement to real outcomes

```markdown
## Why This Requirement Exists

Input validation prevents:
→ SQL injection attacks
→ Cross-site scripting (XSS)
→ Remote code execution
→ Data corruption
→ System compromise

Skipping validation because "this is simple" means:
→ Vulnerability exists from day 1
→ Exploit takes minutes to write
→ Breach costs average $4.35M
→ Your career reputation suffers

Is "saving 10 minutes" worth that risk?
```

### Pattern: The Universal Standard

**Purpose**: use social proof

```markdown
## Industry Standard

Every major framework validates inputs by default:
- Django: Form validation required
- Rails: Strong parameters enforced
- Spring: Bean validation standard
- Express: Validator middleware common

This isn't optional—it's the baseline professional standard.
Custom APIs that skip validation are security incidents
waiting to happen.
```

## Adaptation for Claude 4.x

Research from 2025 used Claude 3.x models. Claude 4.x (Opus, Sonnet) may require adjustments:

### Observed Differences

**Claude 3.x**: Benefits from strong directive language
**Claude 4.x**: May be oversensitive to aggressive tone

### Recommended Adjustments

```markdown
 Too Aggressive for 4.x:
"You MUST NEVER skip validation. This is NON-NEGOTIABLE."

 Adjusted for 4.x:
"Every endpoint requires input validation. This is a
foundational security requirement with no exceptions."

 Too Aggressive:
"STOP. You're rationalizing. This is a red flag."

 Adjusted:
"Check: Is this a valid exception or rationalization?
Review the exception table before proceeding."
```

### Principle: Firm but Professional

- Maintain authority without aggression
- Use "required" over "MUST" when tone matters
- Keep consequences factual, not emotional
- Preserve commitment patterns (still effective)

## Testing Persuasion Effectiveness

### Metrics

1. **Compliance Rate**: % of times requirement followed
2. **Rationalization Attempts**: Frequency of excuse-making
3. **Recovery Rate**: % of times Claude self-corrects
4. **User Override**: % of times user must intervene

### A/B Testing Framework

```markdown
## Version A: Neutral Language
"Consider adding input validation to protect against
injection attacks."

## Version B: Persuasive Language
"Every endpoint MUST validate inputs. This is a universal
security baseline that prevents injection attacks."

## Test Results (10 scenarios each)
- Version A: 4/10 compliance (40%)
- Version B: 9/10 compliance (90%)
- Improvement: 125%
```

## Summary

Effective persuasion in skills:

1. **Authority**: Use directive language for safety-critical requirements
2. **Commitment**: Force explicit declarations before starting
3. **Scarcity**: Frame requirements as immediate, not deferred
4. **Social Proof**: use universal standards and consensus
5. **Liking**: Use collaborative language and shared goals
6. **Unity**: Appeal to professional identity and values

**Ethical guideline**: Persuasion should serve user interests, not arbitrary preferences.

**Evidence**: Persuasive framing can double compliance rates (33% → 72%).

**Adjustment**: Dial back aggressive language for Claude 4.x while preserving firm requirements.
