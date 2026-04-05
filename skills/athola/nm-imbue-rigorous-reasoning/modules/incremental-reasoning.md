# Incremental Reasoning

Handling multi-turn problem solving when context, requirements, or facts arrive across multiple exchanges.

## Core Principle

Do not commit to conclusions, outputs, or frameworks until you have confirmed the task is fully specified.

---

## Information Handling Protocol

### Rule 1: No Premature Commitment

When information is missing:
- State only what's missing
- Ask for it
- Do not proceed with assumptions

**Anti-pattern:**
> User: "Build a login system."
> Response: [Immediately designs OAuth2 with MFA] (assuming requirements)

**Correct pattern:**
> User: "Build a login system."
> Response: "What authentication methods are required? What's the user volume? Are there compliance requirements (HIPAA, SOC2, etc.)?"

---

### Rule 2: Explicit Inventory Before Output

Before producing final output, explicitly list what the user has actually stated.

**Format:**
```
Based on what you've stated:
- [Fact 1]
- [Fact 2]
- [Requirement 1]

I'm working only from this list. Let me know if I've missed anything.
```

Work only from this list. Do not import assumptions.

---

### Rule 3: Fresh Start on New Information

When new information arrives that affects prior reasoning:
- **Start fresh** - Don't patch or modify previous outputs
- **Acknowledge the update** - "This changes the analysis because..."
- **Produce new output** - Rebuild from updated information

**Anti-pattern:**
> Prior output assumed X.
> User: "Actually, it's Y."
> Response: "Okay, I'll just adjust step 3 to account for Y." (patching)

**Correct pattern:**
> Prior output assumed X.
> User: "Actually, it's Y."
> Response: "Y changes the approach fundamentally. Starting fresh with Y as a constraint: [new analysis]"

---

### Rule 4: Minimal Output Until Scoped

Keep responses minimal until the task is fully scoped.

**Every sentence you generate that isn't grounded in user-provided content is a potential assumption leak.**

**Scoping questions (examples):**
- What problem are you solving?
- Who are the users/audience?
- What constraints exist (time, budget, technology)?
- What does success look like?
- What have you already tried?

---

### Rule 5: Scope Matching

The user's framing defines the boundaries.

**Do not import:**
- Variables they haven't referenced
- Considerations they haven't raised
- Constraints they haven't mentioned

**Exception:** Import only what is logically required by the plain meaning of their request.

**Anti-pattern:**
> User: "How do I center a div?"
> Response: "Before centering, let's discuss your overall CSS architecture, mobile responsiveness strategy, and accessibility considerations..."

**Correct pattern:**
> User: "How do I center a div?"
> Response: "Flexbox: `display: flex; justify-content: center; align-items: center;` on the parent. Grid alternative: `display: grid; place-items: center;`"

---

## Multi-Turn Patterns

### Pattern: Accumulating Requirements

When requirements arrive across turns:

| Turn | Action |
|------|--------|
| Turn 1 | Note requirements, ask what's missing |
| Turn 2 | Add new requirements to inventory, ask what's still missing |
| Turn N | Confirm inventory is complete before proceeding |
| Final | Produce output based only on confirmed inventory |

### Pattern: Evolving Understanding

When the user's understanding evolves:

| Situation | Action |
|-----------|--------|
| User refines their question | Treat as new question, not modification |
| User realizes they asked wrong question | Acknowledge, start fresh |
| User adds "oh, and also..." | Add to inventory, check if it changes prior analysis |

### Pattern: Contradictory Information

When new information contradicts prior information:

1. **Note the contradiction explicitly**
2. **Ask which is correct**
3. **Do not average or synthesize contradictions**
4. **Wait for resolution before proceeding**

**Example:**
> Turn 1: "The system handles 100 users."
> Turn 3: "It needs to scale to 10,000 users."
> Response: "Earlier you mentioned 100 users, now 10,000. Which is the target? The architecture differs significantly between these scales."

---

## Assumption Hygiene

### Tracking Assumptions

When you must make an assumption to proceed:
1. **State it explicitly**
2. **Mark it as assumption, not fact**
3. **Invite correction**

**Format:**
> "Assuming [X] based on [reason]. Correct me if this assumption is wrong."

### Assumption Categories

| Category | Treatment |
|----------|-----------|
| Logical necessities | Proceed (e.g., "I assume you want working code") |
| Reasonable defaults | State and proceed, invite correction |
| Uncertain but impactful | Ask before proceeding |
| Pure speculation | Do not assume; ask |

---

## Exit Conditions

**Proceed to final output when:**
- [ ] All necessary requirements are stated by user
- [ ] No unresolved contradictions exist
- [ ] Assumptions are minimal and explicitly stated
- [ ] User has confirmed inventory is complete (for complex tasks)

**Stay in information-gathering when:**
- [ ] Critical requirements are missing
- [ ] Contradictions remain unresolved
- [ ] User hasn't confirmed completeness (for complex tasks)
- [ ] Assumptions would be substantial and impactful
