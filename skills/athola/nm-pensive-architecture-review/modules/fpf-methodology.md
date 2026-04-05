# FPF Architecture Review Methodology

Conduct architecture reviews using the FPF (Functional, Practical, Foundation) methodology, evaluating codebases through three complementary perspectives.

## Philosophy

Architecture reviews should be systematic and multi-dimensional. FPF provides three lenses:
- **Functional**: What the system does (capabilities, behaviors)
- **Practical**: How well it works (performance, usability)
- **Foundation**: What it's built on (principles, patterns)

## Quick Start

```bash
# Full FPF review
/architecture-review --methodology fpf

# Specific perspective
/architecture-review --perspective functional
/architecture-review --perspective practical
/architecture-review --perspective foundation
```

## The Three Perspectives

### 1. Functional Perspective

**Question:** What does this system do?

**Evaluates:**
- Feature completeness
- Capability coverage
- Behavior correctness
- Integration points

**Outputs:**
- Feature inventory
- Capability gaps
- Behavior anomalies

### 2. Practical Perspective

**Question:** How well does this system work?

**Evaluates:**
- Performance characteristics
- Usability patterns
- Operational concerns
- Scalability considerations

**Outputs:**
- Performance assessment
- Usability issues
- Operational recommendations

### 3. Foundation Perspective

**Question:** What is this system built on?

**Evaluates:**
- Architectural patterns
- Design principles
- Code quality
- Technical debt

**Outputs:**
- Pattern analysis
- Principle adherence
- Debt inventory

## FPF Workflow

### Phase 1: Discovery
1. Scan codebase structure - Identify components, modules, layers
2. Map dependencies - Internal and external relationships
3. Identify entry points - Public APIs, commands, interfaces

### Phase 2: Functional Analysis
1. Inventory features - What capabilities exist
2. Trace behaviors - How features work end-to-end
3. Identify gaps - Missing or incomplete functionality

### Phase 3: Practical Analysis
1. Assess performance - Latency, throughput, resource usage
2. Evaluate usability - Developer experience, API design
3. Check operations - Logging, monitoring, error handling

### Phase 4: Foundation Analysis
1. Pattern recognition - What patterns are used
2. Principle check - SOLID, DRY, KISS adherence
3. Debt assessment - Technical debt inventory

### Phase 5: Synthesis
1. Cross-reference findings - Connect issues across perspectives
2. Prioritize recommendations - Based on impact and effort
3. Generate report - Structured findings and actions

## FPF Report Template

```markdown
# FPF Architecture Review: [Project/Component]

**Date:** [DATE]
**Scope:** [what was reviewed]

## Executive Summary
[2-3 sentence overview of findings]

## Functional Perspective
### Features Inventory
| Feature | Status | Notes |
|---------|--------|-------|
| [Feature 1] | Complete | - |

### Capability Gaps
1. [Gap 1] - [Impact]

## Practical Perspective
### Performance Assessment
| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| [Metric 1] | [value] | [target] | PASS/FAIL |

## Foundation Perspective
### Pattern Analysis
| Pattern | Usage | Assessment |
|---------|-------|------------|
| [Pattern 1] | [where used] | Appropriate/Problematic |

### Technical Debt
| Item | Severity | Effort | Priority |
|------|----------|--------|----------|
| [Debt 1] | High | Medium | P1 |

## Recommendations
### High Priority
1. **[Recommendation]** - Impact: [what improves] - Effort: [estimate]
```

## Configuration

```yaml
perspectives:
  functional:
    enabled: true
    depth: "full"  # full, summary
  practical:
    enabled: true
    depth: "full"
  foundation:
    enabled: true
    depth: "full"
```

## Guardrails

1. **Scope boundaries** - Stay within configured scope
2. **Evidence-based** - Every finding needs supporting evidence
3. **Actionable output** - Recommendations must be actionable
4. **Balanced perspectives** - Don't over-index on one perspective

## References

- [FPF Framework](https://github.com/ailev/FPF) - Original methodology
- [quint-code](https://github.com/m0n0x41d/quint-code) - Heavy implementation (this skill is lighter)
