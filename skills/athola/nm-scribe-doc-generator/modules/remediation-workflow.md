---
module: remediation-workflow
category: writing-quality
dependencies: [Edit, Read]
estimated_tokens: 400
---

# Documentation Remediation Workflow

Step-by-step process for cleaning up AI-generated content.

## Phase 1: Assessment

Run slop-detector and categorize findings:

```markdown
## Remediation Assessment: [filename]

**Slop Score**: X.X
**Word Count**: N

### Critical (fix immediately)
- [ ] Vapid opener at line 1
- [ ] "cannot be overstated" at line 45

### High Priority (fix in this pass)
- [ ] 8 tier-1 slop words
- [ ] Em dash density 7/1000

### Medium Priority (fix if time)
- [ ] Bullet ratio 55%
- [ ] Sentence uniformity

### Low Priority (defer)
- [ ] Minor vocabulary substitutions
```

## Phase 2: User Approval for Major Changes

If remediation requires:
- Deleting entire sections
- Restructuring document flow
- Changing technical content

Always ask:

```markdown
## Major Change Required

The opening section (lines 1-25) is primarily filler with no
technical content. Options:

1. **Delete entirely** - Start at line 26 with actual information
2. **Condense to 2 sentences** - Keep intro but remove fluff
3. **Rewrite** - New opening based on document purpose

Which approach? [1/2/3]
```

## Phase 3: Section-by-Section Editing

For documents over 200 lines, process in sections:

```markdown
## Section 1: Introduction (Lines 1-45)

### Current State
> In today's rapidly evolving technological landscape,
> comprehensive documentation plays a pivotal role in
> ensuring seamless developer experiences...

### Issues
- Vapid opener
- "comprehensive", "pivotal", "seamless" (tier 1/2 words)
- No concrete information in 45 words

### Proposed Revision
> scribe checks documentation for AI-generated patterns
> and provides rewriting guidance. This guide covers
> installation, configuration, and usage.

### Changes
- Removed opener cliche
- Replaced with direct statement
- Cut word count from 45 to 22

Proceed? [Y/n/edit]
```

## Phase 4: Vocabulary Sweep

After structural fixes, sweep for remaining vocabulary:

```bash
# Quick vocabulary check
grep -nE '\b(delve|embark|leverage|utilize|comprehensive)\b' file.md
```

Apply substitutions from shared module:

| Line | Current | Replacement |
|------|---------|-------------|
| 23 | leverage | use |
| 45 | utilize | use |
| 67 | comprehensive | thorough |

## Phase 5: Structural Polish

Final pass for structural issues:

1. **Em dashes**: Replace excessive uses with commas/periods
2. **Lists**: Convert bullet waterfalls to prose
3. **Sentence variation**: Add short/long variety
4. **Contractions**: Add if tone is informal

## Phase 6: Verification

Re-run slop-detector:

```markdown
## Remediation Results

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Slop score | 4.8 | 1.2 | -75% |
| Tier 1 words | 12 | 0 | -100% |
| Em dash density | 7/1000 | 2/1000 | -71% |
| Bullet ratio | 55% | 30% | -45% |

Status: CLEAN
```

## Docstring Mode

For code files, special handling:

1. Extract docstrings only (don't modify code)
2. Apply vocabulary substitutions
3. Convert to imperative mood
4. Verify with slop-detector
5. Re-insert docstrings

```python
# ONLY these parts change:
def function():
    """
    BEFORE: "This function leverages advanced algorithms to
    comprehensively process the input data."

    AFTER: "Process input data and return result."
    """
    # Code remains EXACTLY as-is
```
