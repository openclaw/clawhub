---
name: semantic-categorization
description: Framework for categorizing changes by type and semantic meaning
parent_skill: imbue:diff-analysis
category: analysis-framework
tags: [categorization, semantic-analysis, change-types]
estimated_tokens: 300
---

# Semantic Categorization

## Change Categories

Group changes by their structural nature:

- **Additions**: New capabilities, files, or entities introduced
- **Modifications**: Changes to existing behavior or structure
- **Deletions**: Removed capabilities or deprecated items
- **Renames/Moves**: Reorganization without functional change

## Semantic Categories

Classify changes by their purpose and impact:

- **Features**: New user-facing capabilities or functionality
- **Fixes**: Corrections to existing behavior, bug resolutions
- **Refactors**: Structural improvements without behavior change
- **Tests**: Test coverage additions or modifications
- **Documentation**: Explanatory content, guides, or inline documentation changes
- **Configuration**: Settings, environment variables, infrastructure, or build configuration changes

## Git Diff-Filter Examples

Use git's `--diff-filter` flag to isolate specific change types:

```bash
git diff --name-only --diff-filter=A <baseline>  # Added files
git diff --name-only --diff-filter=M <baseline>  # Modified files
git diff --name-only --diff-filter=D <baseline>  # Deleted files
git diff --name-only --diff-filter=R <baseline>  # Renamed files
```

## Cross-Cutting Changes

Identify changes that span multiple categories or subsystems:
- Feature additions that also update tests and documentation
- Refactors that touch multiple modules
- Configuration changes that affect multiple environments
- Breaking changes that require coordinated updates

## Categorization Workflow

1. **Structural First**: Group by addition/modification/deletion
2. **Semantic Second**: Within each structural group, classify by purpose
3. **Cross-Reference**: Note changes that appear in multiple semantic categories
4. **Prioritize**: Order by impact (breaking > feature > fix > refactor)
