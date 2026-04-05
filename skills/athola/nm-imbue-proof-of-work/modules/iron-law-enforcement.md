# Iron Law Enforcement

## The Iron Law

```
NO SKILL WITHOUT A FAILING TEST FIRST
NO IMPLEMENTATION WITHOUT A FAILING TEST FIRST
NO COMPLETION CLAIM WITHOUT EVIDENCE FIRST
NO CODE WITHOUT UNDERSTANDING FIRST
```

This is the fundamental principle that unites **TDD (Test-Driven Development)** and **BDD (Behavior-Driven Development)** with proof-of-work and skill authoring. It prevents the **Cargo Cult TDD** anti-pattern where tests are written to validate pre-conceived implementations rather than to discover the right implementation.

### TDD + BDD: Complementary Practices

| Practice | Focus | Format | Enforcement |
|----------|-------|--------|-------------|
| **TDD** | Test drives design | RED-GREEN-REFACTOR | Git history shows test commits before implementation |
| **BDD** | Behavior describes intent | Given-When-Then scenarios | Tests have Feature/Scenario docstrings |

**Both are required.** TDD ensures tests come first; BDD ensures tests describe behavior, not implementation details.

### The Fourth Law: Understanding Before Code

The fourth principle addresses **cargo cult programming** - the ritual inclusion of code that "looks right" but nobody can explain. Studies show up to 48% of AI-generated code contains vulnerabilities from unexamined adoption.

**Understanding Verification Questions:**
- Can I explain WHY this code exists, not just WHAT it does?
- What would break if I removed this line?
- Why this approach over simpler alternatives?
- When would this fail?

See [anti-cargo-cult.md](anti-cargo-cult.md) for the full protocol.

## Why This Matters (The Reddit Insight)

Classic TDD works because humans "feel their way through uncertainty":

> "I think I want this behaviour... let me code just that & see if it goes green"
> "Oh, that test is awkward to write... maybe my API is wrong"
> "This failure is telling me something about my design choices"

When AI pre-plans implementation before writing tests, the RED phase becomes theater. The Iron Law prevents this by requiring **documented evidence of failure before any intervention**.

## Enforcement Levels

### Level 1: Self-Enforcement (Default)

Claude recognizes Iron Law violations in its own thought process.

**Red Flags That Trigger Self-Enforcement:**

| Thought Pattern | Iron Law Violation | Required Action |
|-----------------|-------------------|-----------------|
| "Let me plan the implementation first" | Skipping RED phase | Write failing test FIRST |
| "I know what tests we need" | Pre-conceived implementation | Document failure, THEN design tests |
| "The test should check for X" | Implementation-driven test | Describe BEHAVIOR, not implementation |
| "This will work because..." | Assumption without evidence | TEST IT, capture evidence |
| "The design is straightforward" | Skipping uncertainty exploration | Write test, let design EMERGE |
| "It's just documentation/config" | Documentation Exception fallacy | Markdown/YAML/shell have testable structure |
| "It's just a module update" | Execution markdown exception | Apply content assertion levels (L1/L2/L3) per leyline:testing-quality-standards |
| "The user wants this quickly" | Speed rationalization | Quality gates are non-negotiable |
| "Files exist, so it works" | Existence ≠ functionality | Test BEHAVIOR, not just existence |

**Self-Check Protocol:**

```markdown
## Iron Law Self-Check

Before writing ANY code:
1. [ ] Do I have documented evidence of a failure/need?
2. [ ] Am I about to write a test that validates a pre-conceived implementation?
3. [ ] Am I feeling uncertainty about the design? (Good - that's what tests are for)
4. [ ] Have I let the test drive the implementation, or vice versa?
5. [ ] Can I explain WHY this approach, not just WHAT it does?

If I answered "no" to #1, #3, or #5, or "yes" to #2 or #4: STOP AND RESET.
```

### Execution Markdown = Code

> **Note:** L1/L2/L3 below refer to content assertion depth per `leyline:testing-quality-standards`, distinct from this document's Enforcement Levels 1-5.

Markdown files under `skills/`, `agents/`, `modules/`, and `commands/` directories are execution markdown. Claude interprets them as behavioral instructions. They require content assertions following the L1/L2/L3 taxonomy defined in `leyline:testing-quality-standards/modules/content-assertion-levels.md`.

**Iron Law applied to execution markdown:**

- **L1 assertions** (keyword presence) are the minimum for any skill or module change
- **L2 assertions** (code example validity) are required when the file contains JSON, YAML, or code blocks that Claude will copy as templates
- **L3 assertions** (behavioral contracts) are required when the file defines decision frameworks, version gates, or behavioral guidance that affects user outcomes

The Documentation Exception case study demonstrated that 37 BDD tests were needed for a single skill's content. Content assertion levels provide the framework for knowing WHICH tests to write, not just that tests are needed.

## BDD Test Structure Requirement

All tests MUST follow BDD structure:

```python
class TestFeatureName:
    """
    Feature: [Clear feature description]

    As a [stakeholder]
    I want [feature capability]
    So that [benefit/value]
    """

    @pytest.mark.unit
    def test_scenario_with_clear_outcome(self):
        """
        Scenario: [Clear scenario description]
        Given [initial context]
        When [action occurs]
        Then [expected outcome]
        """
        # Arrange (Given)
        # Act (When)
        # Assert (Then)
```

**BDD Enforcement Checklist:**
- [ ] Test class has Feature docstring (As a/I want/So that)
- [ ] Test method has Scenario docstring (Given/When/Then)
- [ ] Test describes BEHAVIOR not implementation
- [ ] Test name reflects the scenario, not the method being tested

---

## Cargo Cult TDD Anti-Patterns

**Testing theater** - tests that look right but don't actually verify behavior:

| Anti-Pattern | Description | Detection |
|--------------|-------------|-----------|
| **Assert True** | Tests that always pass | `assert True`, `expect(true).toBe(true)` |
| **Implementation Testing** | Tests HOW not WHAT | Mocking every internal |
| **Copy-Paste Tests** | Tests copied from examples | No understanding of what's being tested |
| **Coverage Gaming** | 100% coverage with trivial tests | High coverage, low mutation score |
| **Behavior Blindness** | Tests that don't catch real bugs | Mutation testing fails |

**The "AI Wrote My Tests" Problem:**

AI-generated tests are particularly prone to cargo cult patterns:
- Tests validate the AI's implementation, not desired behavior
- Tests pass but don't catch intentional mutations
- Tests look comprehensive but miss edge cases
- Tests mock so much they test mocks, not code

**Prevention:** Apply mutation testing. If tests don't fail when code is intentionally broken, they're cargo cult tests.

---

### Level 2: Adversarial Verification (Subagent Pattern)

Based on successful community patterns, use adversarial agents to verify Iron Law compliance.

**The RED-GREEN-REFACTOR Subagent Pattern:**

```yaml
# Agent 1: RED Agent (Test Author)
role: Write ONLY failing tests
constraints:
  - Cannot see implementation plans
  - Cannot write implementation code
  - Must document WHAT should happen, not HOW
input: Given-When-Then requirement
output: Failing test + failure evidence

# Agent 2: GREEN Agent (Implementer)
role: Write MINIMAL code to pass tests
constraints:
  - Can ONLY see failing tests, not requirements
  - Must write minimum code to go green
  - Cannot add "nice to have" features
input: Failing test
output: Minimal passing implementation

# Agent 3: REFACTOR Agent (Code Improver)
role: Improve code quality WITHOUT changing behavior
constraints:
  - Cannot add new functionality
  - All tests must remain green
  - Focus on readability, not features
input: Passing implementation + tests
output: Refactored code + green tests
```

**Adversarial Verification Rule:**

> "For every automated thing you ask an LLM to do, create an equal and opposite agent to verify that it did it."

---

### Level 3: Git History Analysis (Post-Hoc Verification)

Analyze git history to detect Iron Law violations.

**TDD-Compliant Commit Pattern:**

```
commit 1: RED - Add failing test for [feature]
commit 2: GREEN - Implement [feature] to pass test
commit 3: REFACTOR - Clean up [feature] implementation
```

**Violation Detection Signals:**

| Git Pattern | Violation Type | Evidence |
|-------------|---------------|----------|
| Implementation commit without prior test commit | Skipped RED phase | `git log --oneline` shows code before test |
| Test and implementation in same commit | Fake TDD | `git show <sha>` shows both changes |
| Test commit after implementation commit | Retrofitted tests | Timestamps inverted |
| Multiple features in one commit | Scope creep | Large diff with unrelated changes |

**Git History Audit Command:**

```bash
# Check if TDD was followed for recent commits
git log --oneline -10 | while read sha msg; do
  files=$(git show --name-only --format="" $sha)
  has_test=$(echo "$files" | grep -E "test_|_test\.|\.spec\." || true)
  has_impl=$(echo "$files" | grep -vE "test_|_test\.|\.spec\." || true)

  if [ -n "$has_impl" ] && [ -z "$has_test" ]; then
    echo "WARNING: $sha may violate Iron Law (implementation without test)"
  fi
done
```

---

### Level 4: Pre-Commit Hook Enforcement

Enforce Iron Law at commit time.

**Pre-Commit Hook Pattern:**

```bash
#!/usr/bin/env bash
# .git/hooks/pre-commit - Iron Law Enforcement

# Check if this is an implementation commit
impl_files=$(git diff --cached --name-only | grep -vE "test_|_test\.|\.spec\." | grep -E "\.(py|js|ts|rs|go)$")
test_files=$(git diff --cached --name-only | grep -E "test_|_test\.|\.spec\.")

if [ -n "$impl_files" ] && [ -z "$test_files" ]; then
    echo "IRON LAW VIOLATION: Implementation changes without test changes"
    echo ""
    echo "Implementation files:"
    echo "$impl_files"
    echo ""
    echo "Options:"
    echo "1. Add tests for these changes"
    echo "2. Use 'git commit --allow-empty -m \"RED: failing test for...\"' first"
    echo "3. Set IRON_LAW_SKIP=1 to bypass (NOT RECOMMENDED)"

    if [ "${IRON_LAW_SKIP:-0}" != "1" ]; then
        exit 1
    fi
fi

# If we have tests, verify they fail first (mutation testing light)
if [ -n "$test_files" ]; then
    echo "Verifying tests are meaningful (not assert(true))..."

    # Check for suspicious test patterns
    for file in $test_files; do
        if git show ":$file" | grep -qE "assert.*True|assert.*1.*==.*1|expect.*toBe.*true"; then
            echo "WARNING: $file may contain trivial assertions"
        fi
    done
fi

exit 0
```

---

### Pillar 3 Implementation: Automated Mutation Testing

> **Status: IMPLEMENTED** via `.github/workflows/mutation-testing.yml`

Mutation testing (Pillar 3 of the Iron Law) is now enforced through a GitHub Actions
workflow that runs weekly and on-demand via `workflow_dispatch`. It uses `mutmut` to
mutate Python source files in each plugin's `scripts/` directory and reports mutation
scores in the GitHub Actions step summary. To run manually, trigger the
"Mutation Testing (Iron Law Pillar 3)" workflow from the Actions tab and select a
plugin (or "all").

---

### Level 5: Coverage Gate Enforcement

Require evidence of test quality, not just test existence.

**Three-Pillar Coverage:**

```markdown
## Coverage Requirements (Iron Law Compliant)

### 1. Line Coverage
- Minimum: 80%
- Measures: Which lines were executed
- Limitation: Can be gamed with trivial tests

### 2. Branch Coverage
- Minimum: 70%
- Measures: Which decision paths were taken
- Limitation: Doesn't prove behavior correctness

### 3. Mutation Coverage
- Minimum: 60%
- Measures: Whether tests catch deliberate bugs
- This is the TRUE test of test quality

**Why Mutation Testing Matters:**

A test that passes when the code is WRONG is worthless.
Mutation testing introduces bugs and checks if tests fail.

Example:
```python
# Original code
def is_adult(age): return age >= 18

# Mutation 1: Change >= to >
def is_adult(age): return age > 18

# If tests still pass, they don't actually test boundary!
```
```

**Coverage Verification Protocol:**

```bash
# Before claiming implementation complete:

# 1. Line + Branch coverage
pytest --cov=src --cov-branch --cov-fail-under=80

# 2. Mutation coverage (if mutmut/pytest-mutate available)
mutmut run --paths-to-mutate src/
mutmut results

# Evidence format:
# [E-COV1] Line coverage: 87% (target: 80%) - PASS
# [E-COV2] Branch coverage: 73% (target: 70%) - PASS
# [E-COV3] Mutation score: 65% (target: 60%) - PASS
```

---

## Integration with Proof-of-Work

The Iron Law enforcement extends proof-of-work with TDD-specific validation:

### Extended TodoWrite Items

```markdown
## Iron Law TodoWrite Items

- `proof:iron-law-red` - Failing test written BEFORE implementation
- `proof:iron-law-green` - Minimal implementation passes test
- `proof:iron-law-refactor` - Code improved without behavior change
- `proof:iron-law-coverage` - Coverage gates passed (line/branch/mutation)
- `proof:iron-law-git-audit` - Git history shows TDD compliance
```

### Completion Claim Format (Iron Law Enhanced)

```markdown
## Implementation Complete: [Feature Name]

### Iron Law Compliance
- [E-TDD1] RED: Failing test committed at <sha> - [Link to commit]
- [E-TDD2] GREEN: Implementation committed at <sha> - [Link to commit]
- [E-TDD3] REFACTOR: Cleanup committed at <sha> - [Link to commit]

### Coverage Evidence
- [E-COV1] Line: 87% (target: 80%) - PASS
- [E-COV2] Branch: 73% (target: 70%) - PASS
- [E-COV3] Mutation: 65% (target: 60%) - PASS

### Acceptance Criteria
- [E1] Feature works as specified - [Test output]
- [E2] Edge cases handled - [Test output]
- [E3] No regressions - [Test suite output]

### Status
COMPLETE - Iron Law compliant, all coverage gates passed
```

---

## Recovery from Violations

If Iron Law was violated (implementation before test):

### Option 1: Delete and Redo (Preferred)

```bash
# Undo the implementation commit
git reset --soft HEAD~1

# Start over with RED phase
# Write failing test first, commit
# Then write implementation, commit
```

### Option 2: Retrofit with Acknowledgment

```markdown
## Iron Law Violation Acknowledgment

I violated the Iron Law by writing implementation before tests.

### Evidence of Violation
- Implementation commit: <sha>
- Test commit: <sha> (AFTER implementation)

### Why This Happened
[Explain the rationalization that led to violation]

### Mitigation
- Added comprehensive tests after the fact
- Coverage gates still passed: [evidence]
- Tests are behavior-driven, not implementation-driven: [evidence]

### Prevention
[What configuration change prevents this in future?]
```

---

### Case Study: The "Documentation Exception" Violation (2025-01-15)

**Context:** Creating a new skill (`rigorous-reasoning`) for anti-sycophancy reasoning.

**Violation:** Created 8 markdown files (SKILL.md + 7 modules) and updated README/hook without writing any tests first.

**Rationalization Chain:**
1. "Skills are documentation, not code" → FALSE (skills have testable structure)
2. "The hook test proves it works" → FALSE (only tested JSON serialization)
3. "The user wanted it fast" → RATIONALIZATION (speed ≠ quality waiver)

**Detection:** User invoked `/fix-workflow` asking about Iron Law compliance.

**Remediation:**
1. Wrote 37 BDD-style tests covering:
   - Skill existence and structure (6 tests)
   - Module existence and content (14 parametrized tests)
   - Hook integration (3 tests)
   - Required sections and patterns (14 tests)
2. Found and fixed one test (spec mismatch: "polite" vs "politeness")
3. All 37 tests passed

**Lessons Learned:**
- Markdown files have testable structure (existence, sections, patterns)
- "ls -la shows files exist" is NOT functional verification
- Tests for skills should verify: existence, required content, module links, hook integration

**Prevention Added:**
- New red flags in self-enforcement table: "It's just documentation/config"
- New section in red-flags.md: "The Documentation Exception Family"
- This case study as documentation

---

## Self-Improvement Protocol

Based on community best practices:

> "Any time it gets done and it hasn't met the coverage requirements, I ask it how that was possible if it was following TDD? It'll give me a reason... then I'll ask it to adjust its configurations to prevent that from happening in the future."

**After Iron Law Violation:**

1. **Identify**: How did the violation happen?
2. **Understand**: What rationalization allowed it?
3. **Configure**: What rule/hook prevents it next time?
4. **Test**: Verify the new rule catches future violations

**Configuration Evolution Example:**

```markdown
## Iron Law Configuration History

### v1: Basic self-enforcement
- Relied on Claude checking itself
- FAILURE: Claude rationalized "quick fix" exceptions

### v2: Added pre-commit hook
- Blocks implementation-only commits
- FAILURE: Claude committed test+impl together

### v3: Added git history audit
- Verifies test commits precede implementation
- FAILURE: Claude wrote trivial tests

### v4: Added mutation testing
- Verifies tests actually catch bugs
- CURRENT: Working well, 95% compliance
```

---

## Summary

The Iron Law is not just a principle - it's a system of enforcement:

1. **Self-Enforcement**: Red flags table, self-check protocol
2. **Adversarial Verification**: RED/GREEN/REFACTOR subagents
3. **Git History Analysis**: Post-hoc verification of TDD compliance
4. **Pre-Commit Hooks**: Prevent violations at commit time
5. **Coverage Gates**: Ensure test quality, not just existence
6. **Self-Improvement**: Learn from violations, strengthen rules

**The goal**: Make it easier to follow the Iron Law than to violate it.
