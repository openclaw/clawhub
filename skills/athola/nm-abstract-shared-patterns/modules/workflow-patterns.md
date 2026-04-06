# Workflow Patterns

Reusable workflow structures for skills.

## Checklist Template

### Copyable Checklist Format

```markdown
Copy this checklist and track your progress:

```
Task Progress:
- [ ] Step 1: [Action]
- [ ] Step 2: [Action]
- [ ] Step 3: [Action]
- [ ] Step 4: [Action]
- [ ] Step 5: [Verification]
```

**Step 1: [Action]**

[Detailed instructions]

**Step 2: [Action]**

[Detailed instructions]

...
```

### Checklist Best Practices

1. **Keep steps atomic** - Each step should be one action
2. **Include verification** - Last step should verify success
3. **Order matters** - Steps should be sequential dependencies
4. **Be specific** - Include exact commands or actions

## Feedback Loop Pattern

### Validate-Fix-Repeat

```markdown
## Validation Loop

1. Run validation:
   ```bash
   python scripts/validate.py path/to/target
   ```

2. If errors found:
   - Review error messages
   - Fix each issue
   - **Return to step 1**

3. Only proceed when validation passes

4. [Next phase of workflow]
```

### With Exit Conditions

```markdown
## Review Loop

Repeat until all criteria met:

1. Run analysis
2. Check results against criteria:
   - [ ] All tests pass
   - [ ] No security issues
   - [ ] Performance within limits
3. If any criterion fails:
   - Fix the specific issue
   - Return to step 1
4. Proceed when all criteria pass
```

## Progressive Disclosure Structure

### Overview → Details Pattern

```markdown
# [Skill Name]

## Quick Start
[20-30 lines of essential usage]

## Common Tasks
### Task 1
[Brief description and command]

### Task 2
[Brief description and command]

## Advanced Usage
For detailed patterns, see [modules/advanced.md](modules/advanced.md)

## Troubleshooting
For common issues, see [modules/troubleshooting.md](modules/troubleshooting.md)
```

### Conditional Loading

```markdown
## Feature Selection

Choose your path:

**Creating new content?**
→ Follow the [creation workflow](modules/creation.md)

**Modifying existing content?**
→ Follow the [editing workflow](modules/editing.md)

**Troubleshooting issues?**
→ Check [troubleshooting](modules/troubleshooting.md)
```

## Decision Flowchart Template

### Text-Based Decision Tree

```markdown
## Decision Guide

Start here ↓

**Is this a new skill?**
├── Yes → Go to "Creating Skills"
└── No ↓

**Is this modifying an existing skill?**
├── Yes → Go to "Editing Skills"
└── No ↓

**Is this evaluating skills?**
├── Yes → Use `skills-eval`
└── No → Describe your goal
```

### Table-Based Decisions

| Condition | Action |
|-----------|--------|
| New skill needed | Use `skill-authoring` |
| Skill needs evaluation | Use `skills-eval` |
| Hook development | Use `hook-authoring` |
| Plugin validation | Use `validate-plugin` |

## Phase-Based Workflow

### TDD Phases Template

```markdown
## Phase 1: RED (Baseline)

**Goal**: Document current behavior without the skill

1. [ ] Create 3+ test scenarios
2. [ ] Run scenarios without skill
3. [ ] Document failures verbatim
4. [ ] Note rationalization patterns

**Exit criteria**: Baseline documented

---

## Phase 2: GREEN (Implementation)

**Goal**: Create minimal skill that addresses failures

1. [ ] Write SKILL.md addressing failures
2. [ ] Test with skill present
3. [ ] Verify improvement

**Exit criteria**: Skill addresses baseline failures

---

## Phase 3: REFACTOR (Bulletproof)

**Goal**: Close loopholes and strengthen

1. [ ] Identify new rationalizations
2. [ ] Add explicit counters
3. [ ] Create rationalization table
4. [ ] Re-test until bulletproof

**Exit criteria**: No bypass patterns found
```

## Error Recovery Pattern

```markdown
## Error Handling

If you encounter an error:

1. **Read the error message carefully**
   - Note the error code
   - Note the location (file:line)

2. **Check common causes**:
   | Error | Likely Cause | Fix |
   |-------|--------------|-----|
   | E001 | Missing field | Add required field |
   | E002 | Invalid format | Check field constraints |
   | W001 | File too long | Split into modules |

3. **Apply the fix**

4. **Re-run validation**

5. If error persists, check [troubleshooting](modules/troubleshooting.md)
```
