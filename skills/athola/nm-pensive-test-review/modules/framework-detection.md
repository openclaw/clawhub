---
parent_skill: pensive:test-review
name: framework-detection
description: Language and test framework detection patterns
category: testing
tags: [testing, framework-detection, language-detection]
load_priority: 1
estimated_tokens: 250
---

# Framework Detection

Identify testing frameworks and tooling constraints.

## Language Detection Patterns

### Rust
- **Framework**: cargo test (built-in)
- **Commands**: `cargo test`, `cargo nextest run`
- **Config files**: `Cargo.toml`, `Cargo.lock`
- **Test patterns**: `#[test]`, `#[cfg(test)]`
- **MSRV**: Check `rust-version` in Cargo.toml

### Python
- **Frameworks**: pytest, unittest, behave
- **Commands**: `pytest`, `python -m pytest`, `behave`
- **Config files**: `pytest.ini`, `pyproject.toml`, `tox.ini`
- **Test patterns**: `test_*.py`, `*_test.py`, `tests/`
- **Version**: Check `requires-python` in pyproject.toml

### JavaScript/TypeScript
- **Frameworks**: Jest, Mocha, Cypress, Vitest
- **Commands**: `npm test`, `yarn test`, `cypress run`
- **Config files**: `jest.config.js`, `vitest.config.ts`, `cypress.config.js`
- **Test patterns**: `*.test.js`, `*.spec.ts`, `__tests__/`
- **Version**: Check `engines.node` in package.json

### Go
- **Framework**: go test (built-in)
- **Commands**: `go test ./...`, `go test -v`
- **Config files**: `go.mod`, `go.sum`
- **Test patterns**: `*_test.go`
- **Version**: Check `go` directive in go.mod

## Detection Workflow

1. **Scan for config files**:
```bash
find . -maxdepth 2 -name "Cargo.toml" -o -name "pyproject.toml" -o -name "package.json" -o -name "go.mod"
```

2. **Check test directories**:
```bash
find . -type d -name "tests" -o -name "__tests__" -o -name "test"
```

3. **Identify test files**:
```bash
find . -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" \
  \( -name "*test*" -o -name "*spec*" \) \
  | grep -E '\.(rs|py|js|ts|go)$'
```

4. **Version constraints**:
- Extract MSRV, Python version, Node version
- Note if constraints affect tooling (e.g., async/await)
- Document CI/CD version requirements

## Output Format

```markdown
## Framework Detection
- **Languages**: Rust, Python
- **Frameworks**: cargo test, pytest
- **Versions**:
  - Rust MSRV: 1.70
  - Python: >=3.8
- **Config files**: Cargo.toml, pyproject.toml
```
