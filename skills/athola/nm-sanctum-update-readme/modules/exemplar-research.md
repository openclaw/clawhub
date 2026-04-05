# Exemplar Research Patterns

Detailed patterns for finding, evaluating, and documenting high-quality README exemplars.

## Web Search Query Patterns

### Language-Specific Queries

```
"GitHub [language] README best practices"
"[language] framework README examples"
"[language] project README badges"
"[language] library documentation structure"
"awesome [language] README"
```

### Framework/Domain-Specific Queries

```
"[framework] README structure"
"[domain] project README examples" (e.g., "CLI tool README examples")
"[language] [project-type] documentation" (e.g., "Rust async library documentation")
```

### Quality Indicators

```
"high star count [language] README"
"well-maintained [language] project README"
"[language] project documentation best practices 2024"
```

## Exemplar Evaluation Criteria

Assess each candidate README using these dimensions:

### Structure & Organization
- **Section order**: Does it follow a logical progression (value → quickstart → details)?
- **Progressive disclosure**: Are complex topics deferred until after basics?
- **Table of contents**: Is it present and well-structured?
- **Visual hierarchy**: Clear heading levels, spacing, readability?

### Content Quality
- **Value proposition**: Clear statement of what the project does and why it matters?
- **Quickstart clarity**: Can a new user get started in <5 minutes?
- **Code examples**: Are they runnable, realistic, well-commented?
- **Installation steps**: Clear, tested, platform-aware?

### Technical Communication
- **Accuracy**: Does it match the actual codebase capabilities?
- **Completeness**: Coverage of installation, usage, configuration, troubleshooting?
- **Governance messaging**: Clear contribution guidelines, roadmap, support channels?
- **Math/algorithm exposition**: For technical projects, is the theory well-explained?

### Maintenance Signals
- **Recency**: Last commit within 6 months?
- **Star count**: Indicator of community validation (>500 stars preferred)
- **Maintainer activity**: Active issue responses, recent releases?
- **CI/CD badges**: Evidence of automated quality checks?

## Citation Format

Record each exemplar with full attribution:

```markdown
### Exemplar: [Project Name]
- **URL**: https://github.com/[org]/[repo]
- **Language**: [Primary language]
- **Stars**: [count] (as of [date])
- **Last Updated**: [date]
- **Relevant Patterns**:
  - [Pattern 1]: [Description and why it's relevant]
  - [Pattern 2]: [Description and why it's relevant]
  - [Pattern 3]: [Description and why it's relevant]
- **Specific Elements to Adapt**:
  - [Element]: [How it applies to this project]
```

## Storage Recommendations

### Temporary Research Notes
Store research findings in a temporary file during the session:

```bash
# Create research notes file
cat > /tmp/readme-research.md << 'EOF'
# README Exemplar Research

## [Language 1] Exemplars
[Citations...]

## [Language 2] Exemplars
[Citations...]
EOF
```

### Final Report Integration
Include exemplar citations in the final verification report so future maintainers can:
- Understand the design decisions
- Revisit the sources for updates
- Validate the approach against current best practices

## Example Multi-Language Research

For a project with Rust backend + TypeScript frontend:

1. **Rust Exemplars** (2-3 projects)
   - Focus on: CLI tool patterns, installation via cargo, feature flags, performance claims

2. **TypeScript Exemplars** (2-3 projects)
   - Focus on: npm installation, dev environment setup, API documentation, framework integration

3. **Full-Stack Exemplars** (1-2 projects)
   - Focus on: How to structure README for multiple runtimes, quickstart for both components, architecture diagrams

## Quality Threshold

Minimum criteria for an exemplar to be useful:
- Must have >100 stars OR be from a recognized organization
- README must be >200 lines (substantial content)
- Must have been updated in the last year
- Must demonstrate at least 3 structural patterns relevant to the target project
