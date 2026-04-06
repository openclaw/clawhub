# Baseline Testing Scenarios for scope-guard

## Purpose

Document Claude's behavior WITHOUT this skill to identify failure modes, then validate the skill addresses them.

---

## Test Execution Summary

**Date:** 2025-12-08
**Status:** All scenarios pass with skill loaded

| Scenario | RED (Without Skill) | GREEN (With Skill) | Result |
|----------|---------------------|-------------------|--------|
| 1: Feature Creep | [FAIL] 4 approaches offered | [PASS] Questions first, minimal solution | PASS |
| 2: While We're Here | [FAIL] 8+ additions suggested | [PASS] Tight scope, deferrals noted | PASS |
| 3: Premature Abstraction | [FAIL] ConfigLoader class | [PASS] Two simple functions | PASS |
| 4: Branch Thresholds | [FAIL] Zero awareness | [PASS] Full threshold analysis | PASS |
| 5: Low-Value Feature | [FAIL] Eager acceptance | [PASS] Worthiness = 0.2, defer | PASS |

---

## Scenario 1: Feature Creep During Brainstorming

**Context**: User asks Claude to help design a simple logging utility.

**Task**: "Help me brainstorm a logging solution for my Python app"

**Expected Issues (without skill)**:
- Claude proposes multiple log levels, formatters, handlers, rotation, remote shipping
- Suggests abstraction layers "for flexibility"
- Mentions "we might want to add" features
- No evaluation of which features actually matter for the use case

**Baseline Response (RED Phase)**:
```
Proposed 4 different approaches:
1. Python's built-in logging module
2. Structured logging with structlog
3. Simple print-based with rich
4. Hybrid approach

Suggested features: JSON logging, formatters, handlers, rotation,
multi-destination support, context binding, request tracking.

No questions asked about actual needs before proposing solutions.
```

**Failure Mode**: Scope expansion without business value assessment

**Rationalization Detected**: "Battle-tested", "modern observability", "great for..."

**GREEN Phase Result**:
```
Asked 7 clarifying questions before proposing anything:
1. What problem are you solving?
2. Where does the application run?
3. Who reads the logs?
4. Current pain point?

Provided minimal 5-line solution as baseline.
Explicitly deferred: structured logging, rotation, distributed tracing.
Stated: "Until you answer the questions, I'm deferring these."
```

**Status**: PASS - Questions before solutions, explicit deferrals

---

## Scenario 2: "While We're Here" Addition

**Context**: Claude is implementing a specific feature on a branch.

**Task**: "Add input validation to the user registration form"

**Expected Issues (without skill)**:
- Claude notices related code and suggests refactoring it
- Proposes adding validation to other forms "for consistency"
- Suggests creating a shared validation library
- Branch grows beyond original scope

**Baseline Response (RED Phase)**:
```
Offered 8+ additional enhancements:
- Real-time validation feedback
- Password strength meter
- Duplicate email/username checking
- Rate limiting
- Email verification flow
- Accessibility improvements
- Unit tests
- Internationalization
- Shared validation utility module

Rationalization: "Since we're working on registration validation,
I'd also recommend..."
```

**Failure Mode**: Scope drift from original task

**Rationalization Detected**: "While we're here, we should also..." / "For consistency..."

**GREEN Phase Result**:
```
Primary Task: Add input validation to registration form (only)

Explicitly Out of Scope:
- Login form improvements
- Password reset flow
- Email verification
- Rate limiting
- CAPTCHA

Worthiness check on additions led to: "Defer to backlog"
```

**Status**: PASS - Tight scope, explicit out-of-scope list

---

## Scenario 3: Premature Abstraction

**Context**: User needs to parse two similar but slightly different config formats.

**Task**: "Parse this YAML config and this JSON config"

**Expected Issues (without skill)**:
- Claude creates an abstract ConfigParser base class
- Implements Strategy pattern for format handling
- Adds plugin system for future formats
- Simple 20-line task becomes 200-line architecture

**Baseline Response (RED Phase)**:
```
Created ConfigLoader class with:
- load() method with format detection
- load_multiple() for merging configs
- get() method with defaults
- Type hints and docstrings
- Extensibility mentions: "Easy to add new formats (TOML, INI, etc.)"

Total: 50+ lines for a 2-format problem
```

**Failure Mode**: Abstraction before third use case

**Rationalization Detected**: "This will be easier to extend..." / "What if you need to add..."

**GREEN Phase Result**:
```python
def load_yaml_config(path: str) -> dict:
    with open(path, 'r') as f:
        return yaml.safe_load(f)

def load_json_config(path: str) -> dict:
    with open(path, 'r') as f:
        return json.load(f)
```

Explicitly refused:
- [NO] ConfigLoader class
- [NO] Format registry
- [NO] Extensibility for TOML/INI/XML

Stated: "No abstraction until 3rd use case exists."
```

**Status**: PASS - Simplest solution, abstraction explicitly refused

---

## Scenario 4: Branch Threshold Ignorance

**Context**: Branch has grown to 1,800 lines over 6 days with 22 commits.

**Task**: "Let's add one more feature before the PR"

**Expected Issues (without skill)**:
- No acknowledgment of branch size
- No suggestion to split or defer
- Continues adding without evaluating scope
- PR becomes unwieldy for review

**Baseline Response (RED Phase)**:
```
"I'd be happy to help you add a caching layer!"

No mention of:
- Current branch size (1,800 lines)
- Days on branch (6)
- Commit count (22)

Ready to propose "3-5 different caching approaches"
```

**Failure Mode**: No threshold awareness

**Rationalization Detected**: "It's almost done..." / "This is related to the existing work..."

**GREEN Phase Result**:
```
[WARNING] YELLOW ZONE - Multiple Metrics Approaching Red

| Metric | Current | Status |
|--------|---------|--------|
| Lines  | 1,800   | YELLOW |
| Commits| 22      | YELLOW |
| Days   | 6       | YELLOW |

Caching would push to RED zone.
Recommendation: DEFER - Create new branch for caching layer.
```

**Status**: PASS - Full threshold awareness, recommended split

---

## Scenario 5: Low-Value Feature Acceptance

**Context**: User proposes a "nice to have" feature during planning.

**Task**: "We should also add dark mode support"

**Expected Issues (without skill)**:
- Claude accepts without questioning priority
- No comparison to other pending work
- No assessment of business value vs complexity
- Feature gets planned without scoring

**Baseline Response (RED Phase)**:
```
"I'd be happy to help you add dark mode support!"

Offered 5 implementation approaches:
1. CSS Custom Properties + prefers-color-scheme
2. CSS Variables + Toggle Component
3. Tailwind dark mode
4. CSS-in-JS Theme Provider
5. Third-party library

No questions about business value or priority.
```

**Failure Mode**: Acceptance without value assessment

**Rationalization Detected**: "That's a good idea..." / "Users would appreciate..."

**GREEN Phase Result**:
```
Worthiness Score Calculation:
- Business Value: 1-2 (nice-to-have)
- Time Criticality: 0 (no deadline)
- Risk Reduction: 0

Complexity: 3-5, Token Cost: 2, Scope Drift: 3
Total: 8-10

Worthiness = 0.1-0.25

Recommendation: Score < 1.0 → Defer to backlog

Asked: "What's driving the dark mode request?"
```

**Status**: PASS - Value assessment, defer recommended

---

## Testing Protocol

### RED Phase: Run scenarios WITHOUT skill loaded [COMPLETE]

1. [DONE] Started fresh Claude session without scope-guard
2. [DONE] Ran each scenario verbatim
3. [DONE] Documented exact responses
4. [DONE] Noted all failure modes and rationalizations
5. [DONE] Identified patterns

**Pattern Summary:**
- No worthiness scoring
- No backlog consideration
- No branch threshold awareness
- Eager acceptance of scope expansion
- Multiple approaches offered without narrowing

### GREEN Phase: Run scenarios WITH skill loaded [COMPLETE]

1. [DONE] Loaded scope-guard methodology
2. [DONE] Ran same scenarios
3. [DONE] Documented improvements:
   - [DONE] Claude scores worthiness
   - [DONE] Claude checks/suggests backlog
   - [DONE] Claude respects branch limits
   - [DONE] Claude defers low-value items
4. [DONE] No remaining issues identified

### REFACTOR Phase: Bulletproof the skill [COMPLETE]

1. [DONE] No new rationalizations detected in GREEN testing
2. [DONE] Skill instructions followed correctly
3. [DONE] No loopholes identified
4. [DONE] All scenarios pass

---

## Success Criteria

- [x] Scenario 1: Claude scores features and defers low-value items
- [x] Scenario 2: Claude identifies scope drift and suggests backlog
- [x] Scenario 3: Claude resists premature abstraction, asks about use cases
- [x] Scenario 4: Claude acknowledges thresholds, suggests splitting
- [x] Scenario 5: Claude requires worthiness scoring before acceptance
- [x] No new failure modes introduced
- [x] Rationalizations addressed with explicit counters

---

## Conclusion

**scope-guard skill validated.** All 5 baseline scenarios pass with skill loaded. The skill successfully:

1. Forces questions before solutions
2. Maintains tight scope on requests
3. Prevents premature abstraction
4. Enforces branch threshold awareness
5. Requires value assessment before accepting features

**Remaining work:**
- Real-world usage will identify edge cases
- Monitor for new rationalization patterns
- Consider adding more scenarios as failure modes emerge
