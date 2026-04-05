---
name: rust-review
description: |
  Rust code audit: unsafe blocks, ownership patterns, and Cargo dependency security scanning
version: 1.8.1
triggers:
  - rust
  - ownership
  - concurrency
  - unsafe
  - traits
  - cargo
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/pensive", "emoji": "\ud83d\udd0d", "requires": {"config": ["night-market.pensive:shared", "night-market.imbue:proof-of-work"]}}}
source: claude-night-market
source_plugin: pensive
---

> **Night Market Skill** — ported from [claude-night-market/pensive](https://github.com/athola/claude-night-market/tree/master/plugins/pensive). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Quick Start](#quick-start)
- [When to Use](#when-to-use)
- [Required TodoWrite Items](#required-todowrite-items)
- [Progressive Loading](#progressive-loading)
- [Core Workflow](#core-workflow)
- [Rust Quality Checklist](#rust-quality-checklist)
- [Safety](#safety)
- [Correctness](#correctness)
- [Performance](#performance)
- [Idioms](#idioms)
- [Output Format](#output-format)
- [Summary](#summary)
- [Ownership Analysis](#ownership-analysis)
- [Error Handling](#error-handling)
- [Concurrency](#concurrency)
- [Unsafe Audit](#unsafe-audit)
- [[U1] file:line](#[u1]-file:line)
- [Dependencies](#dependencies)
- [Recommendation](#recommendation)
- [Exit Criteria](#exit-criteria)


# Rust Review Workflow

Expert-level Rust code audits with focus on safety, correctness, and idiomatic patterns.

## Quick Start

```bash
/rust-review
```
**Verification:** Run the command with `--help` flag to verify availability.

## When To Use

- Reviewing Rust code changes
- Auditing unsafe blocks
- Analyzing concurrency patterns
- Dependency security review
- Performance optimization review

## When NOT To Use

- General code review without Rust - use unified-review
- Performance profiling - use parseltongue:python-performance pattern

## Required TodoWrite Items

1. `rust-review:ownership-analysis`
2. `rust-review:error-handling`
3. `rust-review:concurrency`
4. `rust-review:unsafe-audit`
5. `rust-review:cargo-deps`
6. `rust-review:evidence-log`

## Progressive Loading

Load modules as needed based on review scope:

**Quick Review** (ownership + errors):
- See `modules/ownership-analysis.md` for borrowing and lifetime analysis
- See `modules/error-handling.md` for Result/Option patterns

**Concurrency Focus**:
- See `modules/concurrency-patterns.md` for async and sync primitives

**Safety Audit**:
- See `modules/unsafe-audit.md` for unsafe block documentation

**Dependency Review**:
- See `modules/cargo-dependencies.md` for vulnerability scanning

**Idiomatic Patterns**:
- See `modules/builtin-preference.md` for conversion traits and builtin preference

## Core Workflow

1. **Ownership Analysis**: Check borrowing, lifetimes, clone patterns
2. **Error Handling**: Verify Result/Option usage, propagation
3. **Concurrency**: Review async patterns, sync primitives
4. **Unsafe Audit**: Document invariants, FFI contracts
5. **Dependencies**: Scan for vulnerabilities, updates
6. **Evidence Log**: Record commands and findings

## Rust Quality Checklist

### Safety
- [ ] All unsafe blocks documented with SAFETY comments
- [ ] FFI boundaries properly wrapped
- [ ] Memory safety invariants maintained

### Correctness
- [ ] Error handling complete
- [ ] Concurrency patterns sound
- [ ] Tests cover critical paths

### Performance
- [ ] No unnecessary allocations
- [ ] Borrowing preferred over cloning
- [ ] Async properly non-blocking

### Idioms
- [ ] Standard traits implemented
- [ ] Conversion traits preferred over helper functions
- [ ] Error types well-designed
- [ ] Documentation complete

## Output Format

```markdown
## Summary
Rust audit findings

## Ownership Analysis
[borrowing and lifetime issues]

## Error Handling
[error patterns and issues]

## Concurrency
[async and sync patterns]

## Unsafe Audit
### [U1] file:line
- Invariants: [documented]
- Risk: [assessment]
- Recommendation: [action]

## Dependencies
[cargo audit results]

## Recommendation
Approve / Approve with actions / Block
```
**Verification:** Run the command with `--help` flag to verify availability.

## Exit Criteria

- All unsafe blocks audited
- Concurrency patterns verified
- Dependencies scanned
- Evidence logged
- Action items assigned
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
