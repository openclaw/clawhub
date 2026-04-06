---
name: heuristic-classifier
description: Pattern-based classification rules mapping file paths and change types to risk tiers
parent_skill: leyline:risk-classification
category: infrastructure
estimated_tokens: 250
---

# Heuristic Classifier

## Pattern-Based Classification Rules

The classifier evaluates task risk by matching affected file paths against pattern rules. Higher-tier matches take precedence.

### CRITICAL Patterns

```
migrations/*delete*        # Destructive migration
migrations/*drop*          # Table/column drops
*.sql DROP                 # Raw SQL drops
*.sql TRUNCATE             # Data truncation
security/credentials*      # Credential management
**/secrets*                # Secret files
deploy/production*         # Production deployment
infrastructure/prod*       # Production infrastructure
**/data-deletion*          # Data deletion scripts
```

### RED Patterns

```
migrations/*               # Any database migration
auth/*                     # Authentication modules
**/authentication*         # Auth-related files
**/authorization*          # Authorization logic
*.env*                     # Environment configuration
database/*schema*          # Database schema definitions
**/encryption*             # Encryption modules
**/security/*              # Security directory
**/permissions*            # Permission definitions
**/api/schema*             # API schema (breaking changes)
**/shared/types*           # Shared type definitions (cross-module)
```

### YELLOW Patterns

```
src/components/*           # UI components (user-visible)
routes/*                   # Route definitions
views/*                    # View layer
**/api/endpoints*          # API endpoints
**/api/routes*             # API route handlers
**/services/*              # Service layer
**/middleware/*            # Middleware (request handling)
**/config/*                # Application configuration
**/templates/*             # Templates (user-visible)
**/styles/*                # Stylesheets (user-visible)
```

### GREEN (Default)

Everything not matching above patterns, including:

```
tests/*                    # Test files
docs/*                     # Documentation
**/*.md                    # Markdown files
**/utils/*                 # Utility functions
**/helpers/*               # Helper functions
**/types/*                 # Type definitions (module-local)
**/constants*              # Constants
**/__tests__/*             # Test directories
**/fixtures/*              # Test fixtures
**/mocks/*                 # Mock files
```

## Additional Classification Dimensions

### Change Type Multiplier

| Change Type | Effect |
|------------|--------|
| Add (new file) | No escalation |
| Modify (existing) | No escalation |
| Delete (remove file) | Escalate +1 tier |
| Rename/Move | Escalate +1 tier if cross-module |

### File Count Escalation

| File Count | Effect |
|-----------|--------|
| 1 file | No escalation |
| 2-5 files | No escalation |
| 6-10 files | Escalate to YELLOW minimum |
| 11+ files | Escalate to RED minimum |

### Dependency Depth

If the changed file is imported by many other files (high fan-out), escalate:

| Import Count | Effect |
|-------------|--------|
| 0-5 importers | No escalation |
| 6-15 importers | Escalate to YELLOW minimum |
| 16+ importers | Escalate to RED minimum |

## Classification Algorithm

```
function classify(task):
    tier = GREEN

    for file in task.affected_files:
        pattern_tier = match_patterns(file.path)
        tier = max(tier, pattern_tier)

    # Apply change type multiplier (escalate by 1 tier, capped at CRITICAL)
    if any(file.change_type == DELETE for file in task.affected_files):
        TIERS = [GREEN, YELLOW, RED, CRITICAL]
        tier = TIERS[min(TIERS.index(tier) + 1, len(TIERS) - 1)]

    # Apply file count escalation
    if len(task.affected_files) >= 11:
        tier = max(tier, RED)
    elif len(task.affected_files) >= 6:
        tier = max(tier, YELLOW)

    # Apply dependency depth (if analyzable)
    max_importers = max(count_importers(f) for f in task.affected_files)
    if max_importers >= 16:
        tier = max(tier, RED)
    elif max_importers >= 6:
        tier = max(tier, YELLOW)

    return tier
```
