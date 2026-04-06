# Test Discovery Module

## Overview

Identifies what needs testing or updating by analyzing code structure, git changes, and existing test coverage.

## Discovery Strategies

### 1. detailed Codebase Scan
- Analyze all Python files for test coverage
- Identify functions, classes, and modules without tests
- Check for public API without corresponding tests

### 2. Git-Based Change Detection
- Parse `git diff` to find modified files
- Identify new functions or changed signatures
- Detect breaking changes requiring test updates

### 3. Targeted Analysis
- Accept specific paths or patterns
- Deep dive into particular modules
- Custom filters based on user criteria

## Analysis Patterns

### Code Structure Analysis
```python
# Example patterns for identifying test needs
def discover_test_targets(codebase_path):
    """Discover what needs testing."""

    # Find Python modules
    modules = find_python_modules(codebase_path)

    # Analyze each module for test coverage
    for module in modules:
        public_functions = extract_public_functions(module)
        test_coverage = analyze_existing_tests(module)

        if test_coverage < 1.0:  # 100% coverage target
            report_missing_tests(module, public_functions, test_coverage)
```

### Change Impact Analysis
```python
def analyze_git_changes():
    """Analyze git changes for test impact."""

    # Get changed files
    changed_files = git_diff --name-only HEAD~1

    # Categorize changes
    for file in changed_files:
        if file.endswith('.py'):
            if is_test_file(file):
                mark_for_review(file)  # May need updates
            else:
                mark_for_test_update(file)  # Code changed
```

## Discovery Outputs

### Test Gap Report
- Missing test files
- Uncovered functions/methods
- Modules with low coverage
- Edge cases not tested

### Change Impact Report
- Files modified since last test run
- Functions with changed signatures
- Breaking changes detected
- Integration points affected

### Priority Scoring

- **High**: Public API changes, execution markdown changes (SKILL.md files, agent definitions)
- **Medium**: Internal refactoring, module markdown changes (files under `modules/` directories)
- **Low**: README, CHANGELOG, non-execution documentation, test-only changes

#### Execution Markdown Detection

Files under `skills/`, `agents/`, `modules/`, or `commands/` with `.md` extension are execution markdown -- Claude interprets them as behavioral instructions. These are NOT low-priority documentation changes.

When execution markdown is modified, check for corresponding content tests using the L1/L2/L3 taxonomy. See `modules/content-test-discovery.md` for detection heuristics and gap analysis, and `modules/generation/content-test-templates.md` for BDD test scaffolding.
