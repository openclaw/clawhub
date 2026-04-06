---
module: quality-gates
category: writing-quality
dependencies: [TodoWrite]
estimated_tokens: 300
---

# Documentation Quality Gates

Checklists and thresholds for documentation quality validation.

## Pre-Commit Checklist

Before finalizing any documentation:

### Content Quality
- [ ] No tier-1 slop words present
- [ ] No vapid openers or closers
- [ ] All claims grounded with specifics
- [ ] Trade-offs explained, not just conclusions
- [ ] Authorial perspective present ("we chose", "our tests showed")

### Structure Quality
- [ ] Em dash count < 3 per 1000 words
- [ ] Bullet ratio < 40% (unless reference material)
- [ ] Sentence length varies (SD > 5 words)
- [ ] Paragraphs 2-5 sentences each
- [ ] No five-paragraph essay structure

### Style Quality
- [ ] Consistent voice throughout
- [ ] Appropriate formality for audience
- [ ] Contractions used if informal tone
- [ ] No emojis (unless explicitly requested)

### Technical Quality
- [ ] File paths verified to exist
- [ ] Commands tested and working
- [ ] Version numbers accurate
- [ ] Links not broken

## Metric Thresholds

| Metric | Pass | Warning | Fail |
|--------|------|---------|------|
| Slop score | < 1.0 | 1.0-2.5 | > 2.5 |
| Tier 1 words | 0 | 1-2 | 3+ |
| Em dashes | < 3/1000 | 3-5/1000 | > 5/1000 |
| Bullet ratio | < 30% | 30-50% | > 50% |
| Sentence SD | > 8 | 5-8 | < 5 |

## TodoWrite Integration

Track quality gate status:

```
doc-generator:quality-content - PASS/FAIL
doc-generator:quality-structure - PASS/FAIL
doc-generator:quality-style - PASS/FAIL
doc-generator:quality-technical - PASS/FAIL
```

## Remediation Required

If any gate fails:

1. Identify specific failures
2. Propose fixes
3. Apply fixes
4. Re-run gates
5. Repeat until pass

## Exceptions

Document exceptions when gates are intentionally skipped:

```markdown
## Quality Gate Exception

**Document**: API-reference.md
**Gate**: bullet-ratio (58%)
**Reason**: Reference documentation requires list format
**Approved by**: [user]
**Date**: [date]
```

## Integration with CI

For automated checking:

```yaml
# .github/workflows/docs-quality.yaml
- name: Check documentation quality
  run: |
    scribe scan docs/
    if [ $? -ne 0 ]; then
      echo "Documentation quality check failed"
      exit 1
    fi
```
