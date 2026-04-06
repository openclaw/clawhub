# Content Assertion Quality

Scoring criteria for evaluating content assertion tests during test review. Extends the scenario quality assessment with a Content Depth dimension.

Reference: `leyline:testing-quality-standards/modules/content-assertion-levels.md`

## Content Depth Scoring

Rate content assertion depth on a 1-5 scale:

| Score | Level | Description |
|---|---|---|
| 1 | None | Tests only file existence or line count |
| 2 | L1 | Keyword presence checks (`assert "section" in content`) |
| 3 | L2 | Parses embedded examples, validates schema structure |
| 4 | L3 | Cross-references, anti-patterns, decision framework contracts |
| 5 | L3+ | Cross-plugin validation (version refs checked against other plugins' docs) |

## When to Flag Missing Content Assertions

During test review, flag as a content test gap when:

- A skill has tests but all are L1 (keyword-only) and the skill contains JSON or YAML code blocks
- A skill has version-gated features but no cross-reference validation
- A skill defines behavioral guidance (decision trees, strategies) but no anti-pattern or completeness tests
- A module documents forbidden behaviors but no test asserts their absence

## Content Assertion Anti-Patterns

Avoid these when reviewing content tests:

| Anti-Pattern | Problem | Better Approach |
|---|---|---|
| Testing prose style | Brittle to rewording, overlaps with scribe:slop-detector | Test behavioral semantics |
| Asserting exact wording | Breaks on any edit | Assert concepts (`"version" in content.lower()`) |
| Checking line counts | Not behavioral | Check required sections exist |
| Testing formatting | Not what Claude interprets | Test parseable structure |
| Duplicating slop detection | Already handled by scribe | Focus on correctness, not style |

## Review Checklist Addition

Add this item to the existing Test Quality Checklist when reviewing a plugin that has execution markdown:

```markdown
- [ ] Content assertion depth matches content complexity
      (L1 for simple skills, L2+ for code examples, L3 for behavioral guidance)
```

## Remediation Guidance

When content tests are missing or insufficient:

1. **No content tests at all**: Generate L1 scaffolding using `sanctum:test-updates/modules/generation/content-test-templates.md`
2. **L1 only, has code blocks**: Upgrade to L2 (add JSON/YAML parsing tests)
3. **L2 only, has version gates**: Upgrade to L3 (add cross-reference validation)
4. **L2 only, has behavioral guidance**: Upgrade to L3 (add anti-pattern and completeness tests)
