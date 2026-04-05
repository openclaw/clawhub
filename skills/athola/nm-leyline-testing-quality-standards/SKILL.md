---
name: testing-quality-standards
description: Cross-plugin testing quality metrics, coverage thresholds, and anti-patterns
version: 1.8.1
triggers:
  - testing
  - quality
  - standards
  - metrics
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/leyline", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: leyline
---

> **Night Market Skill** — ported from [claude-night-market/leyline](https://github.com/athola/claude-night-market/tree/master/plugins/leyline). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Testing Quality Standards

Shared quality standards and metrics for testing across all plugins in the Claude Night Market ecosystem.


## When To Use

- Establishing test quality gates and coverage targets
- Validating test suite against quality standards

## When NOT To Use

- Exploratory testing or spike work
- Projects with established quality gates that meet requirements

## Table of Contents

1. [Coverage Thresholds](#coverage-thresholds)
2. [Quality Metrics](#quality-metrics)
3. [Detailed Topics](#detailed-topics)

## Coverage Thresholds

| Level | Coverage | Use Case |
|-------|----------|----------|
| Minimum | 60% | Legacy code |
| Standard | 80% | Normal development |
| High | 90% | Critical systems |
| detailed | 95%+ | Safety-critical |

## Quality Metrics

### Structure
- [ ] Clear test organization
- [ ] Meaningful test names
- [ ] Proper setup/teardown
- [ ] Isolated test cases

### Coverage
- [ ] Critical paths covered
- [ ] Edge cases tested
- [ ] Error conditions handled
- [ ] Integration points verified

### Maintainability
- [ ] DRY test code
- [ ] Reusable fixtures
- [ ] Clear assertions
- [ ] Minimal mocking

### Reliability
- [ ] No flaky tests
- [ ] Deterministic execution
- [ ] No order dependencies
- [ ] Fast feedback loop

## Detailed Topics

For implementation patterns and examples:

- **[Anti-Patterns](modules/anti-patterns.md)** - Common testing mistakes with before/after examples
- **[Best Practices](modules/best-practices.md)** - Core testing principles and exit criteria
- **[Content Assertion Levels](modules/content-assertion-levels.md)** - L1/L2/L3 taxonomy for testing LLM-interpreted markdown files

## Integration with Plugin Testing

This skill provides foundational standards referenced by:
- `pensive:test-review` - Uses coverage thresholds and quality metrics
- `parseltongue:python-testing` - Uses anti-patterns and best practices
- `sanctum:test-*` - Uses quality checklist and content assertion levels for test validation
- `imbue:proof-of-work` - Uses content assertion levels to enforce Iron Law on execution markdown

Reference in your skill's frontmatter:
```yaml
dependencies: [leyline:testing-quality-standards]
```
**Verification:** Run `pytest -v` to verify tests pass.
## Troubleshooting

### Common Issues

**Tests not discovered**
Ensure test files match pattern `test_*.py` or `*_test.py`. Run `pytest --collect-only` to verify.

**Import errors**
Check that the module being tested is in `PYTHONPATH` or install with `pip install -e .`

**Async tests failing**
Install pytest-asyncio and decorate test functions with `@pytest.mark.asyncio`
