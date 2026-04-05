# Anti-Cargo-Cult Reasoning

Prevents superficial technical artifacts created through copy-paste methodology and blind AI delegation. This module provides understanding verification protocols used across imbue skills.

## The Cargo Cult Problem

**Definition:** Cargo cult programming is the ritual inclusion of code, patterns, or practices that serve no understood purpose - code that "looks right" but nobody can explain WHY it works.

**AI Amplification:** AI-generated code is syntactically correct, follows best practices, and comes with confident explanations. This makes cargo cult coding faster and far more convincing than ever before. Studies show up to 48% of AI-generated code snippets contain exploitable vulnerabilities from unexamined adoption.

**Core Insight:** "If you don't understand the code, you'll have no clue how to debug it if something goes wrong."

## Understanding Verification Protocol

Before accepting ANY implementation (AI-generated or copied), apply this protocol:

### The Five Whys of Understanding

| Question | Purpose | Red Flag Answer |
|----------|---------|-----------------|
| **WHY does this approach work?** | Verify causal understanding | "It's best practice" / "The AI suggested it" |
| **WHY this pattern over alternatives?** | Verify trade-off awareness | "It's what [big company] uses" |
| **WHAT breaks if we change X?** | Verify constraint understanding | "I don't know, don't touch it" |
| **HOW does this interact with existing code?** | Verify system understanding | "It shouldn't affect anything" |
| **WHEN would this approach fail?** | Verify limitation awareness | "It should work for everything" |

### Understanding Checklist

Before claiming understanding of any code:

```markdown
## Understanding Verification

- [ ] Can explain WHY each line exists (not just WHAT it does)
- [ ] Can predict what happens if key lines are removed
- [ ] Can describe failure modes and edge cases
- [ ] Can explain trade-offs vs. alternative approaches
- [ ] Can modify the code without copy-pasting more examples
```

## Cargo Cult Red Flags

### Code-Level Red Flags

| Pattern | Cargo Cult Indicator | Required Action |
|---------|---------------------|-----------------|
| "Just copy this snippet" | No understanding verification | Apply Five Whys |
| Configuration you don't understand | Ritualistic inclusion | Research or remove |
| Multiple redundant dependencies | "More must be better" | Audit and justify each |
| Enterprise patterns in simple apps | Complexity theater | Apply YAGNI |
| "Make it production-ready" | Buzzword-driven development | Define specific requirements |

### Thought-Level Red Flags

| Thought Pattern | Reality Check | Action |
|-----------------|---------------|--------|
| "The AI said this is correct" | AI sounds confident but may be wrong | Verify independently |
| "This is how [big company] does it" | They have different constraints | Evaluate YOUR context |
| "It's a best practice" | Best for whom? When? | Identify specific benefit |
| "Modern applications have this" | Appeal to novelty | Identify concrete need |
| "I found this on Stack Overflow" | Popular =/= correct for you | Understand before adopting |

### AI-Specific Red Flags

| AI Output Pattern | Risk | Mitigation |
|-------------------|------|------------|
| Confident explanation without qualification | Hallucinated certainty | Cross-reference docs |
| "This is the standard way" | Pattern imitation | Ask for alternatives |
| Complete solution without questions | Assumed requirements | Verify problem understanding |
| Multiple solutions without trade-off analysis | Shotgun approach | Demand trade-offs |
| Enterprise complexity for simple problem | Overengineering | Apply scope-guard |

## Integration Points

### With proof-of-work

**Understanding before claiming completion:**

```markdown
## Proof-of-Work + Understanding Verification

Before marking `proof:completion-proven`:
- [ ] Can explain implementation without referencing source
- [ ] Have tested by intentionally breaking it
- [ ] Can predict failure modes
- [ ] Have documented WHY not just WHAT
```

### With scope-guard

**Understanding as complexity cost:**

When scoring Worthiness, INCREASE Complexity score if:
- Solution was copied without modification
- Cannot explain why specific approach was chosen
- Adding technology/pattern you haven't used before
- Solution complexity exceeds problem complexity

**Rule:** "If you can't teach it, you don't understand it. If you don't understand it, don't ship it."

### With rigorous-reasoning

**Cargo cult reasoning patterns to catch:**

| Sycophantic Pattern | Cargo Cult Equivalent |
|--------------------|-----------------------|
| "That's a great approach!" | Did you EVALUATE it? |
| "This looks correct" | Did you VERIFY it? |
| "I agree with this pattern" | Did you UNDERSTAND it? |
| "That should work" | Did you TEST it? |

### With iron-law-enforcement

**Cargo cult TDD anti-patterns:**

| TDD Theater | Reality | Iron Law Check |
|-------------|---------|----------------|
| Tests pass but don't test behavior | Ritual testing | Mutation testing |
| Tests copied from examples | Ritual inclusion | Behavior verification |
| 100% coverage with trivial assertions | Metric gaming | Meaningful coverage |
| Test implementation, not behavior | Wrong focus | Ask "What SHOULD happen?" |

## Recovery Protocol

When cargo cult code is detected:

### Step 1: Acknowledge the Gap

```markdown
## Understanding Gap Acknowledged

I included [code/pattern/practice] without sufficient understanding.

### What I Know
- [List concrete understanding]

### What I Don't Know
- [List gaps - be specific]

### Risk Assessment
- Probability of hidden bugs: [Low/Medium/High]
- Debugging difficulty if issues arise: [Low/Medium/High]
```

### Step 2: Fill the Gap or Remove

**Option A: Learn it**
1. Read official documentation (not blog posts)
2. Build a minimal spike to understand behavior
3. Apply Five Whys until you can teach it

**Option B: Remove it**
1. Delete the cargo cult code
2. Find simpler solution you understand
3. Document why the "advanced" solution was rejected

### Step 3: Prevent Recurrence

Add to personal/project checklist:
- "I will not copy code I cannot explain"
- "AI suggestions require the same review as junior dev code"
- "Complexity I don't understand is a liability, not an asset"

## Evidence Format

When documenting understanding verification:

```markdown
[U1] Understanding Claim: [What you're claiming to understand]
     Five Whys Applied:
       - Why this approach? [Answer]
       - Why not X alternative? [Answer]
       - What breaks if changed? [Answer]
     Verification Method: [How you tested understanding]
     Confidence: [High/Medium/Low]
     Gaps Acknowledged: [Any remaining uncertainty]
```

## The Fundamental Rule

> **"If you don't understand the code, don't ship it."**

This applies equally to:
- AI-generated code
- Stack Overflow snippets
- Tutorial code
- "Best practice" boilerplate
- Legacy code you inherited

Understanding is not optional. It's the difference between engineering and ritual.

## Sources

This module synthesizes research from:
- [Wikipedia: Cargo cult programming](https://en.wikipedia.org/wiki/Cargo_cult_programming)
- [NDepend Blog: Programming by Coincidence](https://blog.ndepend.com/cargo-cult-programming/)
- [Medium: AI Creating New Breed of Cargo Cult Programmers](https://medium.com/@egek92/how-ai-is-creating-a-new-breed-of-cargo-cult-programmers-3e44d0bbb047)
- [ACM: Software Reuse in the Generative AI Era](https://dl.acm.org/doi/10.1145/3755881.3755981)
- [Addy Osmani: First Principles for Software Engineers](https://addyosmani.com/blog/first-principles-thinking-software-engineers/)
- [Codurance: TDD Anti-Patterns](https://www.codurance.com/publications/tdd-anti-patterns-chapter-2)
