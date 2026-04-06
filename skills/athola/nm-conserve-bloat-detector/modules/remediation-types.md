---
module: remediation-types
category: remediation
dependencies: []
estimated_tokens: 150
---

# Remediation Types

Shared definitions for bloat remediation actions used by unbloat command and unbloat-remediator agent.

## DELETE (Dead Code Removal)

Remove files with high confidence they're unused:
- 0 references (git grep, static analysis)
- Stale (> 6 months unchanged)
- High confidence (> 90%)
- Non-core files

**Risk Assessment:**
| Risk | Criteria |
|------|----------|
| LOW | deprecated/*, test files, archive/*, 0 refs, 95%+ confidence |
| MEDIUM | 1-2 refs, 85-94% confidence |
| HIGH | >2 refs, <85% confidence, core infrastructure |

## REFACTOR (Split God Classes)

Break large, low-cohesion files into focused modules:
- Large files (> 500 lines)
- Multiple responsibilities (low cohesion)
- High cyclomatic complexity
- Active usage (recent changes)

**Risk Assessment:**
| Risk | Criteria |
|------|----------|
| LOW | Utilities, helpers, pure functions, < 3 import sites |
| MEDIUM | Services, handlers, 3-10 import sites |
| HIGH | Core modules, frameworks, > 10 import sites |

## CONSOLIDATE (Merge Duplicates)

Merge duplicate or redundant content:
- Documentation with > 85% similarity
- Duplicate code patterns
- Multiple versions of same concept

**Risk Assessment:**
| Risk | Criteria |
|------|----------|
| LOW | Docs, examples, pure duplication |
| MEDIUM | Utilities with slight variations |
| HIGH | Business logic, different contexts |

## ARCHIVE (Move to Archive)

Move stale but historically valuable content:
- Old tutorials, examples
- Deprecated but referenced
- Historical documentation

**Risk Assessment:**
| Risk | Criteria |
|------|----------|
| LOW | Examples, tutorials, < 5 refs |
| MEDIUM | Guides, how-tos, 5-10 refs |
| HIGH | Core docs, > 10 refs |

## INLINE (Remove Dead Wrappers)

Replace thin facades and passthrough functions with direct usage of the underlying implementation:
- Whole-file wrappers with 0 external consumers → DELETE
- Intra-file passthrough methods that only delegate → INLINE callers to use wrapped method directly
- Re-export layers where examples/ already demonstrates the same API

**Risk Assessment:**
| Risk | Criteria |
|------|----------|
| LOW | 0 external refs, wrapper adds no logic, underlying module is stable |
| MEDIUM | 1-2 refs, wrapper adds minor convenience (default args, error handling) |
| HIGH | >2 refs, wrapper provides meaningful abstraction or cross-cutting concerns |

**Detection Signals:**
- File imports internal module and re-exports similar API surface
- No `__init__.py` (not a proper package)
- Function bodies are single `return self.other_method(...)` calls
- Duplicate capability exists in `examples/` or `skills/` directories

## Auto-Approval Levels

| Level | Criteria |
|-------|----------|
| `low` | Confidence >= 90%, Risk = LOW, 0 refs, deprecated/test/archive files only |
| `medium` | Confidence >= 80%, Risk <= MEDIUM, <= 2 refs, non-core |
| `none` | Prompts for every change (default, safest) |

**Note:** All levels still show preview before execution.
