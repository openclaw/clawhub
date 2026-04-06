---
name: bug-review
description: Bug hunting with evidence trails: find defects, document them, and verify fixes
version: 1.8.1
triggers:
  - bugs
  - defects
  - debugging
  - code-quality
  - fixes
  - verification
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/pensive", "emoji": "\ud83d\udd0d", "requires": {"config": ["night-market.pensive:shared", "night-market.imbue:proof-of-work", "night-market.imbue:diff-analysis/modules/risk-assessment-framework"]}}}
source: claude-night-market
source_plugin: pensive
---

> **Night Market Skill** — ported from [claude-night-market/pensive](https://github.com/athola/claude-night-market/tree/master/plugins/pensive). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Quick Start](#quick-start)
- [When to Use](#when-to-use)
- [Required TodoWrite Items](#required-todowrite-items)
- [Progressive Loading](#progressive-loading)
- [Workflow](#workflow)
- [Step 1: Detect Languages (`bug-review:language-detected`)](#step-1:-detect-languages-(bug-review:language-detected))
- [Step 2: Plan Reproduction (`bug-review:repro-plan`)](#step-2:-plan-reproduction-(bug-review:repro-plan))
- [Step 3: Document Defects (`bug-review:defects-documented`)](#step-3:-document-defects-(bug-review:defects-documented))
- [Step 4: Prepare Fixes (`bug-review:fixes-prepared`)](#step-4:-prepare-fixes-(bug-review:fixes-prepared))
- [Step 5: Verification Plan (`bug-review:verification-plan`)](#step-5:-verification-plan-(bug-review:verification-plan))
- [Defect Classification (Condensed)](#defect-classification-(condensed))
- [Output Format](#output-format)
- [Summary](#summary)
- [Defects Found](#defects-found)
- [[D1] file.rs:142 - Title](#[d1]-filers:142---title)
- [Proposed Fixes](#proposed-fixes)
- [Fix for D1](#fix-for-d1)
- [Test Updates](#test-updates)
- [Evidence](#evidence)
- [Best Practices](#best-practices)
- [Exit Criteria](#exit-criteria)


# Bug Review Workflow

Systematic bug identification and fixing with language-specific expertise.

## Quick Start

```bash
/bug-review
```
**Verification:** Run the command with `--help` flag to verify availability.

## When To Use

- Reviewing code for potential bugs
- After receiving bug reports
- Before major releases
- During security audits
- Investigating production issues

## When NOT To Use

- Test coverage audit - use test-review instead

## Required TodoWrite Items

1. `bug-review:language-detected`
2. `bug-review:repro-plan`
3. `bug-review:defects-documented`
4. `bug-review:fixes-prepared`
5. `bug-review:verification-plan`

## Progressive Loading

Load additional context as needed:
- **Language Detection**: `@include modules/language-detection.md` - Manifest heuristics, expertise framing, version constraints
- **Defect Documentation**: `@include modules/defect-documentation.md` - Severity classification, root cause analysis, static analyzers
- **Fix Preparation**: `@include modules/fix-preparation.md` - Minimal patches, idiomatic patterns, test coverage

## Workflow

### Step 1: Detect Languages (`bug-review:language-detected`)

Identify dominant languages using manifest files (Cargo.toml → Rust, package.json → Node, etc.).

State expertise persona appropriate for the language ecosystem.

Note version constraints (MSRV, Python versions, Node engines).

**Progressive**: Load `modules/language-detection.md` for detailed manifest heuristics.

### Step 2: Plan Reproduction (`bug-review:repro-plan`)

Identify reproduction methods:
- Unit/integration test suites
- Fuzzing tools
- Manual reproduction commands

Document exact commands:
```bash
cargo test -p core
pytest tests/test_api.py
npm test -- pkg
```
**Verification:** Run `pytest -v tests/test_api.py` to verify.

Capture blockers and propose mocks when dependencies unavailable.

### Step 3: Document Defects (`bug-review:defects-documented`)

Review code line-by-line, logging each bug with:
- **File:line reference**: Precise location
- **Severity**: Critical, High, Medium, Low
- **Root cause**: Logic error, API misuse, concurrency, resource leak
- **Impact**: What breaks and how

Run static analyzers (`cargo clippy`, `ruff check`, `golangci-lint`, `eslint`).

Use `imbue:proof-of-work` for reproducible capture.

**Progressive**: Load `modules/defect-documentation.md` for classification details and analyzer commands.

### Step 4: Prepare Fixes (`bug-review:fixes-prepared`)

Draft minimal, idiomatic patches using language best practices:
- Guard clauses (Rust: pattern matching, Python: early returns)
- Resource cleanup (Go: defer, Python: context managers)
- Error propagation (Rust: ?, Go: wrapped errors)

Create tests following Red → Green pattern:
1. Write failing test
2. Apply minimal fix
3. Verify test passes

**Progressive**: Load `modules/fix-preparation.md` for language-specific patterns and test strategies.

### Step 5: Verification Plan (`bug-review:verification-plan`)

Execute reproduction steps with fixes applied.

Capture evidence:
- Test output logs
- Benchmark comparisons
- Coverage reports

Document remaining risks using `imbue:diff-analysis/modules/risk-assessment-framework`.

Assign owners and deadlines for follow-up items.

## Defect Classification (Condensed)

**Severity**: Critical (crash/data loss) → High (broken features) → Medium (degraded UX) → Low (edge cases)

**Root Causes**: Logic errors | API misuse | Concurrency issues | Resource leaks | Validation gaps

## Output Format

```markdown
## Summary
[Brief scope description]

## Defects Found
### [D1] file.rs:142 - Title
- Severity: High
- Root Cause: Logic error
- Impact: Data corruption possible
- Fix: [description]

## Proposed Fixes
### Fix for D1
[code diff with explanation]

## Test Updates
[new/updated tests with Red → Green verification]

## Evidence
- Commands executed
- Logs and outputs
- External references
```
**Verification:** Run `pytest -v` to verify tests pass.

## Best Practices

1. **Evidence-based**: Every finding has file:line reference
2. **Reproducible**: Clear steps to reproduce each bug
3. **Minimal fixes**: Smallest change that fixes the issue
4. **Test coverage**: Every fix has corresponding test
5. **Risk awareness**: Document remaining risks with severity scoring

## Exit Criteria

- All defects documented with precise references
- Fixes prepared with test coverage verified
- Verification plan includes commands and expected outputs
- Remaining risks assessed and owners assigned
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
