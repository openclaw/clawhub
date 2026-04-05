# Quality Gates Pattern Reference

## Common Quality Gate Commands by Language

### Python Projects
```bash
# Formatting
make format          # or: black . && isort .
ruff format .
uv run ruff format .

# Linting
make lint            # or: ruff check .
mypy .
pylint src/

# Testing
make test            # or: pytest
pytest --cov=src --cov-report=term
uv run pytest
```

### JavaScript/TypeScript Projects
```bash
# Formatting
npm run format       # or: prettier --write .
yarn format

# Linting
npm run lint         # or: eslint .
yarn lint

# Testing
npm test
yarn test
jest --coverage
```

### Go Projects
```bash
# Formatting
go fmt ./...
gofmt -w .

# Linting
golangci-lint run
go vet ./...

# Testing
go test ./...
go test -v -cover ./...
```

### Rust Projects
```bash
# Formatting
cargo fmt

# Linting
cargo clippy -- -D warnings

# Testing
cargo test
cargo test --all-features
```

## Failure Handling Patterns

### When Quality Gates Fail
1. **Capture the exact error output** - Don't summarize, show actual failures
2. **Fix failures immediately** - Never proceed with failing tests
3. **Re-run after fixes** - Confirm all gates pass before continuing
4. **Document what was fixed** - Include in PR testing section

### Common Failure Categories
- **Formatting issues**: Auto-fix with formatter, then re-run
- **Linting warnings**: Address or document why they're acceptable
- **Test failures**: Fix the code or update tests as needed
- **Type errors**: Resolve type mismatches or add proper annotations

## Alternative Validation Approaches

### When Local Tests Can't Run
- **Missing dependencies**: Document what's missing and CI strategy
- **Environment constraints**: Note platform-specific limitations
- **Integration tests**: Explain which will run in CI only
- **Manual verification**: Document steps taken locally instead

### CI/CD Integration Notes
```markdown
## Testing
- Local: `make test` - all unit tests passing
- CI will run: integration tests, E2E tests, cross-platform builds
- Manual verification: Tested CLI commands locally on Ubuntu 22.04
```

## Quality Gate Checklist
- [ ] Formatting passes (no diffs after format command)
- [ ] Linting passes (no warnings or errors)
- [ ] All tests pass locally
- [ ] Type checking passes (if applicable)
- [ ] Build succeeds (if applicable)
- [ ] Manual smoke testing completed

## Special Cases

### Pre-commit Hooks
If project has pre-commit hooks:
```bash
pre-commit run --all-files
```
Document any hooks that were run.

### Multiple Test Suites
```bash
# Unit tests
pytest tests/unit/

# Integration tests
pytest tests/integration/

# E2E tests (may run in CI only)
# Skipped locally - runs in CI environment
```

### Performance Tests
Note if performance benchmarks exist but weren't run:
```markdown
## Testing
- Unit tests: passing
- Performance benchmarks: skipped (run in dedicated CI job)
```
