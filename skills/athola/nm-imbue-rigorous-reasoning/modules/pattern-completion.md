# Pattern Completion Protocol

Use this framework when deriving a complete characterization, formula, or rule from empirical cases or finite examples.

## Step 1: Explicit Falsification Check

Before presenting a proposed pattern as the answer:

### 1a. Enumerate Positive Cases

List every positive case collected during analysis.

### 1b. Verify Each Case

For each case, explicitly verify it satisfies the pattern.

### 1c. Failure Response

If any known-valid case fails membership:
- The pattern is **incomplete**
- Return to analysis
- Do not present as final answer

**Anti-pattern:**
> "The pattern is X." (without showing verification)

**Correct pattern:**
> "Proposed pattern: X
> Verification:
> - Case 1: [satisfies X because...]
> - Case 2: [satisfies X because...]
> - Case 3: [satisfies X because...]
> All known cases pass. Pattern appears complete."

---

## Step 2: Structural Closure Test

If the pattern involves a transformation or recursive structure:

### 2a. Trace the Pre-Image Chain

Follow the chain until it closes.

### 2b. Generator Question

Ask: "What generates the generators?"

### 2c. Depth Check

If valid cases exist at depth N, check whether valid cases exist at depth N+1.

### 2d. Termination Claim

A claim that no cases exist at depth N+1 requires **visible evidence of the search process**.

**Critical rule:** The verification method must appear in the response, not merely its conclusion.

**Invalid:**
> "I verified this thoroughly." (no visible work)
> "I checked extensively." (no visible work)

**Valid:**
> "Checking depth N+1:
> - Possibility A: [eliminated because...]
> - Possibility B: [eliminated because...]
> - Possibility C: [eliminated because...]
> No valid cases at depth N+1. Chain terminates."

### 2e. Stop Condition

Stop only when the structure demonstrably terminates.

---

## Step 3: Unification Pressure

If the answer requires listing separate sub-patterns ("A or B"):

### 3a. Signal Recognition

Treating the answer as a disjunction is a **signal** that a unifying form may exist.

### 3b. Typical Form

The correct answer to a "determine all X" problem is typically:
- A single generating rule
- Not a disjunction of cases

### 3c. Unification Attempt

Before accepting a disjunctive answer, attempt to find the underlying unity:
- What do A and B have in common?
- Is there a more abstract pattern that captures both?
- Are A and B actually special cases of a single rule?

**Anti-pattern:**
> "The solutions are either X or Y." (accepting disjunction immediately)

**Correct pattern:**
> "Initial analysis suggests X or Y. Checking for unification:
> - X and Y both share property P
> - Underlying pattern: [unified rule]
> Single rule: [unified rule]. X and Y are special cases."

**Or if no unification:**
> "Initial analysis suggests X or Y. Unification attempt:
> - Checked for common property: none found
> - Checked for abstract generalization: none found
> The disjunction appears fundamental. Final answer: X or Y."

---

## Verification Template

```markdown
## Pattern Completion: [Problem Description]

### Proposed Pattern
[State the pattern]

### Step 1: Falsification Check
Known positive cases:
1. [Case 1]: [satisfies/fails pattern because...]
2. [Case 2]: [satisfies/fails pattern because...]
3. [Case N]: [satisfies/fails pattern because...]

Status: [ ] All pass [ ] Failure found (return to analysis)

### Step 2: Structural Closure
Transformation/recursion involved: [yes/no]

If yes:
- Depth 0: [cases]
- Depth 1: [cases or "checked, none found because..."]
- Depth N: [cases or termination evidence]

Termination evidence visible: [ ] Yes [ ] No (add evidence)

### Step 3: Unification
Answer form: [ ] Single rule [ ] Disjunction

If disjunction:
- Common property check: [result]
- Abstraction attempt: [result]
- Unification: [ ] Found [ ] Fundamental disjunction

### Final Pattern
[Pattern with all verification complete]
```

---

## Common Errors

### Error: Invisible Verification

**Wrong:** "I've verified this pattern is complete."

**Right:** "Verification:
- Case 1: [check]
- Case 2: [check]
- Depth check: [evidence]
Pattern is complete."

### Error: Premature Disjunction

**Wrong:** "The answer is A or B."

**Right:** "Initial forms A and B. Unification attempt: [work shown]. Result: [unified rule or justified disjunction]."

### Error: Assumed Termination

**Wrong:** "The chain obviously terminates at depth 3."

**Right:** "At depth 3: [cases]. At depth 4: checking possibilities [A, B, C], all eliminated because [reasons]. Chain terminates at depth 3."

### Error: Missing Cases

**Wrong:** "Pattern X covers the examples given."

**Right:** "Pattern X. Checking all known cases:
- Example 1: covered
- Example 2: covered
- Edge case from [source]: covered
- Boundary case: covered
All cases verified."
