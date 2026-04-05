# Pull Request Template Structure

## Standard Template Sections

### 1. Summary (Required)
Brief 1-2 sentence description of what the PR accomplishes and why.

**Good Examples:**
```markdown
## Summary
Add support for modular skills to reduce token usage and improve skill maintainability through progressive loading.
```

```markdown
## Summary
Fix authentication bug causing session timeout errors by implementing proper token refresh logic.
```

**Avoid:**
- Implementation details (save for Changes section)
- Vague descriptions like "various improvements"
- AI/tool attribution

### 2. Changes (Required)
Bullet list of specific changes grouped logically, explaining both what and why.

**Structure:**
```markdown
## Changes
- **Category 1**: What changed and why
  - Sub-detail if needed
- **Category 2**: What changed and why
- **Breaking changes**: Highlight any breaking changes first
```

**Good Examples:**
```markdown
## Changes
- **API**: Add `read_yaml()` and `to_pdf()` functions for symmetric I/O pattern
- **Session Management**: Introduce `ResumeSession` class to centralize configuration
- **Documentation**: Update README with new API examples and migration guide
- **Breaking**: Remove deprecated `generate_pdf()` function (use `to_pdf()` instead)
```

### 3. Testing (Required)
List each validation step taken, with commands and results.

**Format:**
```markdown
## Testing
- `make test` - all 47 tests passing
- `make lint` - no warnings
- `pytest --cov` - 94% coverage (up from 89%)
- Manual verification: Tested PDF generation with 3 resume templates
- CI will run: cross-platform tests, integration tests
```

**Include:**
- Exact commands run
- Pass/fail status and counts
- Coverage changes if significant
- Manual testing performed
- What will run in CI (if different from local)

### 4. Checklist (Required)
Standard quality checklist for all PRs.

**Template:**
```markdown
## Checklist
- [ ] Code follows project style guidelines
- [ ] Tests pass locally
- [ ] Documentation updated if needed
- [ ] Breaking changes documented (if applicable)
```

**Extended Checklist (for complex PRs):**
```markdown
## Checklist
- [ ] Code follows project style guidelines
- [ ] Tests pass locally
- [ ] Tests added/updated for new functionality
- [ ] Documentation updated if needed
- [ ] Breaking changes documented (if applicable)
- [ ] Migration guide provided (if needed)
- [ ] Backward compatibility maintained (or breaking change justified)
- [ ] Performance impact assessed
- [ ] Security implications reviewed
```

## Optional Sections

### Screenshots/Visual Changes
For UI, CLI output, or visual changes:
```markdown
## Screenshots
**Before:**
[screenshot or command output]

**After:**
[screenshot or command output]
```

### Follow-up TODOs
For work deferred to future PRs:
```markdown
## Follow-up Work
- [ ] Add integration tests for edge cases (Issue #123)
- [ ] Update deployment documentation
- [ ] Performance optimization for large files
```

### Issue References
Link related issues:
```markdown
Fixes #456
Related to #789
Part of #101
```

### Migration Guide
For breaking changes:
```markdown
## Migration Guide
**Before:**
\`\`\`python
generate_pdf(resume, "output.pdf")
\`\`\`

**After:**
\`\`\`python
resume.to_pdf("output.pdf")
\`\`\`
```

### Performance Impact
For performance-related changes:
```markdown
## Performance Impact
- PDF generation: 2.3s → 0.8s (65% improvement)
- Memory usage: 150MB → 45MB
- Benchmark results: [link to benchmark output]
```

### Security Considerations
For security-related changes:
```markdown
## Security Considerations
- Input validation added for all user-supplied paths
- Sanitization applied to template variables
- No secrets or credentials in code or tests
```

## Best Practices for PR Descriptions

### Do's
- Be concise but complete
- Focus on "why" not just "what"
- Use bullet points for scannability
- Include actual commands and results
- Link to relevant issues
- Highlight breaking changes prominently
- Use code blocks for examples
- Group related changes together

### Don'ts
- Include AI/tool attribution
- Copy-paste entire file diffs
- Use vague descriptions
- Skip testing documentation
- Hide breaking changes in middle of list
- Include work-in-progress notes
- Reference internal tool commands unless relevant

## Writing Quality (scribe Integration)

Apply `scribe:doc-generator` principles to avoid AI-sounding text:

### Vocabulary to Avoid

| Instead of | Use |
|------------|-----|
| leverage | use |
| utilize | use |
| comprehensive | thorough |
| robust | solid |
| facilitate | help |
| streamline | simplify |
| seamless | smooth |
| delve | explore |

### Phrase Patterns to Remove

- "In order to..." → "To..."
- "It should be noted that..." → (just state it)
- "I'd be happy to..." → (not relevant in PR text)
- "This ensures that..." → (ground with specifics instead)
- Marketing language: "enterprise-ready", "cutting-edge", "best-in-class"

### Quality Checklist

Before finalizing a PR description:

- [ ] No tier-1 slop words present
- [ ] All claims grounded with specifics (numbers, files, commands)
- [ ] Active voice used throughout
- [ ] No formulaic openers or closers
- [ ] Balanced structure (not all bullets)

## Template Variations

### Small Bug Fix
```markdown
## Summary
Fix null pointer exception in PDF generation when resume has no education section.

## Changes
- Add null check before accessing education fields
- Add test case for resumes without education

## Testing
- `pytest tests/test_pdf_generation.py` - all passing
- Verified fix with sample resume lacking education section

## Checklist
- [x] Code follows project style guidelines
- [x] Tests pass locally
- [x] Documentation updated if needed
- [x] Breaking changes documented (if applicable)
```

### Feature Addition
```markdown
## Summary
Add support for exporting resumes to HTML format alongside existing PDF export.

## Changes
- **Core API**: Add `to_html()` method to Resume class
- **Templates**: Create Jinja2 HTML templates matching PDF layouts
- **Testing**: Add HTML generation tests and snapshot testing
- **Documentation**: Update README with HTML export examples

## Testing
- `make test` - 52 tests passing (added 5 new tests)
- `make lint` - no warnings
- Manual verification: Generated HTML from 4 resume templates, verified in Chrome/Firefox
- Snapshot tests validate HTML output consistency

## Checklist
- [x] Code follows project style guidelines
- [x] Tests pass locally
- [x] Documentation updated if needed
- [x] Breaking changes documented (if applicable)
```
