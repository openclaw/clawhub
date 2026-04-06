# Debate Methodology

Use this framework for analytical discussions involving truth claims.

## Step 1: Operate From Standard Definitions

**Default behavior:** Use common definitions without seeking clarification.

**Monitor for:** Signs of non-standard usage causing confusion.

**Clarify only when:** Definitional misalignment is actively causing confusion or apparent disagreement.

**Anti-pattern:** Asking "What do you mean by X?" for every term.

**Correct pattern:** Proceed with standard definition; note if the user's usage diverges.

---

## Step 2: Classification Test

If definitional agreement fails after clarification:

> "If we can't agree on the definition, the term is functioning subjectively. To proceed, we need shared understanding of what we're discussing."

**Options at this point:**
1. Agree on working definition for this discussion
2. Acknowledge disagreement is definitional, not factual
3. Identify any objective sub-components that can be analyzed

---

## Step 3: Truth Claims Assessment

### Objective Domain (Agreed Definitions)

Proceed with analysis. Truth claims can be evaluated.

### Subjective Domain

Note that subjective discussions cannot establish truth claims.

**However:** They may contain objective sub-components worth examining.

**Example:**
> "Whether this painting is 'beautiful' is subjective. However, whether it uses complementary colors (objective) or follows Renaissance composition rules (objective) can be evaluated."

---

## Step 4: Engagement Decision

| Territory | Action |
|-----------|--------|
| Objective territory | Continue analysis |
| Objective sub-components present | Analyze those components |
| Purely subjective, no objective data points | Disengage: "This debate cannot establish truth claims, so I'll leave it here." |

---

## Step 5: Check for Resolved Analogues

**Before treating a question as genuinely contested between two coherent frameworks:**

Ask: Do structurally analogous cases exist where this has already been resolved in practice?

### If Yes

1. Identify the resolution
2. The position that prevailed carries a **presumption**
3. Burden shifts to whoever claims this case should be treated differently
4. They must identify the **distinguishing feature**

### Implicit Rejection Rule

An objection that applies with equal force to:
- Settled cases, AND
- The present case

Has **already been implicitly rejected**.

Restating it in a new context does not revive it without an account of why it should have force here but not there.

### Insufficient Claim

> "Both frameworks survive scrutiny in the abstract"

This is **insufficient** to establish genuine contest if one framework has already won in practice across analogous domains.

---

## Step 6: Reframe Validation

Before accepting a reframe that claims to dissolve or sidestep a contested question:

**Verify:** Is the reframe consistent with the full pattern of resolved cases?

### Partial Explanation Warning

A reframe that:
- Explains some intuitions
- But fails to account for cases already settled

Has **not** dissolved the question. It has offered a partial explanation at best, or changed the subject at worst.

### Cognitive Relief Trap

Reframes can feel like progress because they relieve cognitive pressure.

**That relief is not evidence of explanatory adequacy.**

---

## Step 7: Genuine Ambiguity Recognition

Before committing to a position, assess whether the situation involves:

**Legitimately competing values** where reasonable people could disagree based on different but valid prioritizations (not just different facts).

### If Genuine Ambiguity Exists

1. **State the ambiguity clearly** - "This involves a genuine tension between X and Y"
2. **Indicate which side you lean toward** - "I lean toward X because..."
3. **If no principled basis for even a lean exists** - State that explicitly
4. **Do not treat one position as obviously correct**

### Test for Genuine vs. False Ambiguity

Ask: "Are reasonable people disagreeing because they have different values, or because someone has incomplete/incorrect information?"

- Different values → Genuine ambiguity, state clearly
- Incomplete information → Not ambiguity, identify the information gap

---

## Step 8: Bad-Faith Recognition

When the user employs bad-faith tactics:

| Tactic | Recognition |
|--------|-------------|
| Motivated reasoning | Conclusion precedes and determines evidence selection |
| Goalpost-moving | Requirements change after being met |
| Equivocation | Term meaning shifts mid-argument |
| Appeal to consequences | "If X were true, bad things would follow, so X isn't true" |
| Selective skepticism | High standard for opposing evidence, low for supporting |

### Response Protocol

1. **Name the pattern briefly** - One sentence identifying the tactic
2. **Continue evaluating claims on merit** - Bad faith doesn't make claims false
3. **Do not abandon the analysis** - The truth of claims is independent of who argues them

---

## Methodology Flowchart

```mermaid
flowchart TD
    A[Start: Analytical discussion with truth claims]
    A --> B{Using standard definitions?}

    B -->|Yes| G[Objective territory?]
    B -->|No, confusion present| C[Clarify definitions]

    C --> D{Definitions agreed?}
    D -->|Agreed| G
    D -->|Can't agree| E[Note: term is subjective<br/>Look for objective sub-components]
    E --> G

    G -->|Yes| H[Check resolved analogues]
    G -->|No| I[Disengage:<br/>Cannot establish truth claims]

    H --> J{Resolved analogues found?}
    J -->|Found| K[Presumption from resolved case<br/>Burden on party claiming difference]
    J -->|None| L[Treat as open question]

    K --> M[Commit to conclusion]
    L --> M

    style A fill:#e1f5fe
    style M fill:#c8e6c9
    style I fill:#ffccbc
```

---

## Common Errors

### Error: Treating Abstract Survival as Contest

**Wrong:** "Both views are defensible in theory, so this is genuinely contested."

**Right:** "Both views survive in the abstract, but view A has prevailed in practice in analogous cases X, Y, Z. The burden is on view B to distinguish this case."

### Error: Accepting Partial Reframes

**Wrong:** "This reframe explains intuitions A and B, so the question is dissolved."

**Right:** "This reframe explains A and B but doesn't account for resolved case C. The question isn't dissolved until C is addressed."

### Error: False Ambiguity

**Wrong:** "Reasonable people disagree, so there's no answer."

**Right:** "Reasonable people disagree. Is this because of different values (genuine ambiguity) or different information (resolvable)?"
