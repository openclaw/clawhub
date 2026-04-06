# Module Selection Strategies

## Overview

Selection strategies determine which modules to load based on context signals, user intent, available resources, and workflow requirements. The goal is to load exactly what's needed while respecting token budgets and MECW constraints.

## Core Strategies

### 1. Intent-Based Selection

Load modules based on detected user goals and explicit requests.

**Pattern:**
```python
INTENT_MODULE_MAP = {
    "git-analysis": ["git-catchup-patterns.md"],
    "document-review": ["document-analysis-patterns.md"],
    "log-analysis": ["log-analysis-patterns.md"],
    "architecture-review": ["architecture-patterns.md", "design-principles.md"]
}

def select_by_intent(user_input, skill_modules):
    # Detect intent from keywords, context, explicit requests
    detected_intent = detect_intent(user_input)

    # Map to modules
    return INTENT_MODULE_MAP.get(detected_intent, [])
```

**When to Use:**
- User provides clear task description
- Skill has distinct workflow paths
- Intent keywords are well-defined

**Example:**
```markdown
## Progressive Loading

**Git Analysis**: User mentions "commits", "branches", "git log"
→ Load `modules/git-catchup-patterns.md`

**Document Review**: User mentions "meeting notes", "docs", "markdown"
→ Load `modules/document-analysis-patterns.md`
```

### 2. Artifact-Based Selection

Load modules based on detected files, systems, or environmental signals.

**Pattern:**
```python
def select_by_artifacts(detected_files, detected_systems):
    modules = []

    # File-based detection
    if any(f.endswith('.git') for f in detected_files):
        modules.append("git-workflow.md")

    if any(f.endswith('.py') for f in detected_files):
        modules.append("python-analysis.md")

    # System-based detection
    if "kubernetes" in detected_systems:
        modules.append("k8s-patterns.md")

    return modules
```

**When to Use:**
- Different file types require different analysis
- Environment determines workflow
- System presence indicates needed capabilities

**Example:**
```markdown
## Progressive Loading

**Python Codebase Detected**: `.py` files, `pyproject.toml`, `requirements.txt`
→ Load `modules/python-testing.md`, `modules/python-packaging.md`

**Rust Codebase Detected**: `.rs` files, `Cargo.toml`
→ Load `modules/rust-review.md`, `modules/cargo-patterns.md`
```

### 3. Budget-Aware Selection

Load modules within available token budget, prioritizing by importance.

**Pattern:**
```python
from leyline import MECWMonitor, estimate_tokens

def select_by_budget(available_modules, max_tokens):
    monitor = MECWMonitor()
    selected = []
    total_tokens = 0

    # Sort by priority (core → common → edge cases)
    prioritized = sort_by_priority(available_modules)

    for module in prioritized:
        module_cost = estimate_tokens(module.path)

        if total_tokens + module_cost <= max_tokens:
            selected.append(module)
            total_tokens += module_cost
        else:
            # Skip lower-priority modules if budget exceeded
            break

    return selected
```

**When to Use:**
- Context pressure is moderate to high
- Skills have many optional modules
- Need MECW compliance
- Want to prioritize common paths

**Example:**
```markdown
## Progressive Loading

**LOW Pressure** (< 30%): Load all relevant modules
**MODERATE Pressure** (30-50%): Load core + common modules only
**HIGH Pressure** (> 50%): Load core modules only, defer rest
```

### 4. Progressive (Tiered) Selection

Load in stages: minimal core, then expand based on actual needs.

**Pattern:**
```python
def progressive_select(context, stage="core"):
    if stage == "core":
        # Always load: essential concepts, integration, exit criteria
        return ["core-workflow.md", "integration.md"]

    elif stage == "common":
        # Load for typical use cases
        modules = progressive_select(context, "core")
        modules.extend(["common-patterns.md", "examples.md"])
        return modules

    elif stage == "advanced":
        # Load for edge cases, advanced features
        modules = progressive_select(context, "common")
        modules.extend(["advanced-patterns.md", "troubleshooting.md"])
        return modules
```

**When to Use:**
- Uncertain which modules will be needed
- Want to start fast and expand as needed
- Support both quick tasks and deep dives

**Example:**
```markdown
## Progressive Loading

**Stage 1 (Core)**: Always loaded
- Overview, quick start, integration, exit criteria

**Stage 2 (Common)**: Load when basic workflow confirmed
- Common patterns, examples, typical use cases

**Stage 3 (Advanced)**: Load on explicit request or edge case
- Advanced patterns, troubleshooting, optimization techniques
```

### 5. Mutually-Exclusive Selection

Load one module from a set of alternatives based on context.

**Pattern:**
```python
def select_mutually_exclusive(context, module_groups):
    selected = []

    for group in module_groups:
        # Only one module from each group
        for module in group.modules:
            if module.matches_context(context):
                selected.append(module)
                break  # Don't load other modules from this group

    return selected
```

**When to Use:**
- Multiple workflows that never happen together
- Platform-specific implementations
- Version-specific patterns

**Example:**
```markdown
## Progressive Loading

**Platform Selection** (mutually exclusive):
- Linux detected → Load `modules/linux-patterns.md`
- macOS detected → Load `modules/macos-patterns.md`
- Windows detected → Load `modules/windows-patterns.md`

**Version Selection** (mutually exclusive):
- Python 3.8-3.10 → Load `modules/legacy-python.md`
- Python 3.11+ → Load `modules/modern-python.md`
```

## Combining Strategies

Real-world skills often combine multiple strategies:

```python
def select_modules(context):
    # 1. Check budget first
    safe_budget = MECWMonitor().get_safe_budget()

    # 2. Detect intent and artifacts
    intent_modules = select_by_intent(context.user_input)
    artifact_modules = select_by_artifacts(context.files)

    # 3. Combine and deduplicate
    candidate_modules = list(set(intent_modules + artifact_modules))

    # 4. Apply budget constraints
    selected = select_by_budget(candidate_modules, safe_budget)

    # 5. validate core modules always loaded
    ensure_core_modules(selected)

    return selected
```

## Selection Metadata

Tag modules with selection hints in frontmatter:

```yaml
---
# Module: git-catchup-patterns.md
module_name: git-catchup-patterns
priority: common
estimated_tokens: 450
triggers:
  keywords: [git, commit, branch, diff, log]
  artifacts: [.git/, .gitignore]
  intents: [git-analysis, catchup, history-review]
mutually_exclusive_with: [document-analysis-patterns, log-analysis-patterns]
requires_budget_minimum: 400
---
```

## Context Signal Detection

Common signals for module selection:

### User Input Signals
- **Keywords**: Explicit mentions of technologies, workflows, tasks
- **Question patterns**: "How do I...", "Show me...", "Analyze..."
- **Command requests**: Direct requests for specific operations

### Environmental Signals
- **File presence**: Detected files indicate domain
- **Directory structure**: Project layout suggests patterns
- **Tool availability**: Installed tools suggest workflows

### Session Signals
- **Previous modules**: What's already loaded
- **Task history**: What user has been working on
- **Error patterns**: Repeated failures suggest different module needed

### Resource Signals
- **Token budget**: Available MECW budget
- **Context pressure**: Current utilization level
- **Time constraints**: Need for quick vs detailed loading

## Best Practices

1. **Default to Minimal**: Start with smallest useful set, expand on demand
2. **Document Triggers**: Make selection logic transparent in hub SKILL.md
3. **Measure Accuracy**: Track which modules are actually used vs loaded
4. **Provide Overrides**: Let users force-load specific modules
5. **Fail Gracefully**: If budget insufficient, load core and warn
6. **Cache Decisions**: Don't re-evaluate for same context repeatedly

## Anti-Patterns

**Loading Everything**: Defeats purpose of progressive loading
**Complex Selection Logic**: If selection is hard to understand, simplify
**Ignoring Budget**: Selection must respect MECW constraints
**Silent Failures**: If module can't load, inform user why
**Implicit Dependencies**: Module loading should be deterministic from context

## Integration Points

### With MECW Monitoring
```python
from leyline import MECWMonitor

monitor = MECWMonitor()
if monitor.get_pressure_level() == "HIGH":
    # Select minimal modules only
    modules = select_by_budget(candidates, monitor.get_safe_budget())
```

### With Token Estimation
```python
from leyline import estimate_tokens

total_cost = sum(estimate_tokens(m) for m in selected_modules)
if total_cost > safe_budget:
    # Re-select with lower priority threshold
    selected_modules = select_by_budget(candidates, safe_budget)
```

### With Module Loader
```python
from leyline import progressive_load

modules = progressive_load(
    skill="my-skill",
    context={"intent": "analysis", "artifacts": [".py"]},
    strategy="budget-aware",
    max_tokens=safe_budget
)
```

## Validation Checklist

- [ ] All modules have selection metadata (triggers, priority, cost)
- [ ] Selection logic documented in hub SKILL.md
- [ ] Budget constraints enforced in all strategies
- [ ] Mutually-exclusive groups identified and enforced
- [ ] Core modules always loaded regardless of context
- [ ] Selection deterministic for same context
- [ ] Override mechanism available for explicit requests
