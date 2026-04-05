# Loading Patterns

## Overview

Loading patterns define how modules are actually loaded, cached, unloaded, and switched during skill execution. These patterns implement the selection strategies with concrete mechanisms for managing module lifecycle.

## Core Loading Patterns

### 1. Conditional Includes

Use hub SKILL.md to conditionally reference modules based on context.

**Pattern:**
```markdown
# Skill Hub

## Progressive Loading

Load modules based on context:

**Git Workflow**: Load `modules/git-patterns.md` for git-based tasks
**Python Analysis**: Load `modules/python-patterns.md` for Python code
**API Review**: Load `modules/api-patterns.md` for API design review

**Always Available**: Core concepts, integration points, exit criteria
```

**Implementation:**
- Hub provides navigation map to modules
- Agent/user loads specific module when needed
- No all modules loaded upfront

**When to Use:**
- Simple, declarative loading logic
- Modules are mutually exclusive
- User/agent can select appropriate path

### 2. Lazy Loading

Load modules on first use, not at skill activation.

**Pattern:**
```python
class SkillContext:
    def __init__(self):
        self._loaded_modules = {}
        self._available_modules = self._scan_modules()

    def get_module(self, module_name):
        # Load on first access
        if module_name not in self._loaded_modules:
            module_path = self._available_modules[module_name]
            self._loaded_modules[module_name] = self._load_module(module_path)

        return self._loaded_modules[module_name]

# Usage
context = SkillContext()
# Module not loaded yet
git_patterns = context.get_module("git-patterns")  # Loaded here
```

**When to Use:**
- Uncertain which modules will be needed
- Want fast skill activation
- Many optional modules available

**Benefits:**
- Faster initial load time
- Lower memory/context footprint
- Only pay for what you use

### 3. Tiered Disclosure

Load in predefined tiers: core → common → advanced.

**Pattern:**
```markdown
# Skill Hub

## Overview
[Core concepts - always loaded]

## Quick Start
[Common patterns - ~80% of usage]

For advanced use cases, see:
- `modules/advanced-patterns.md` - Edge cases and optimization
- `modules/troubleshooting.md` - Debugging and fixes
- `modules/performance.md` - Benchmarking and tuning
```

**Implementation:**
```python
def load_tiered(context):
    # Tier 1: Core (always)
    load_content("SKILL.md#overview")
    load_content("SKILL.md#quick-start")

    # Tier 2: Common (if context suggests)
    if context.complexity == "standard":
        load_module("modules/common-patterns.md")

    # Tier 3: Advanced (on explicit request)
    if context.requires_advanced:
        load_module("modules/advanced-patterns.md")
        load_module("modules/troubleshooting.md")
```

**When to Use:**
- Common path well-defined (80/20 rule applies)
- Most users need simple workflow
- Advanced features are truly optional

### 4. Context Switching

Change loaded modules mid-session based on workflow changes.

**Pattern:**
```python
class ProgressiveSkill:
    def __init__(self):
        self.current_modules = []
        self.context = None

    def switch_context(self, new_context):
        # Unload modules from old context
        old_modules = self._get_modules_for_context(self.context)
        new_modules = self._get_modules_for_context(new_context)

        # Only reload what's different
        to_unload = set(old_modules) - set(new_modules)
        to_load = set(new_modules) - set(old_modules)

        for module in to_unload:
            self._unload_module(module)

        for module in to_load:
            self._load_module(module)

        self.context = new_context
        self.current_modules = new_modules
```

**When to Use:**
- Long-running sessions with workflow changes
- Context pressure requires module swapping
- User switches between different tasks

**Example:**
```markdown
# Session Evolution

1. User: "Analyze this git history"
   → Load git-patterns.md

2. User: "Now review the Python code"
   → Unload git-patterns.md
   → Load python-patterns.md

3. User: "Write tests for the changes"
   → Keep python-patterns.md
   → Load testing-patterns.md
```

### 5. Preemptive Unloading

Remove modules when context pressure rises or workflow completes.

**Pattern:**
```python
from leyline import MECWMonitor

def manage_modules(skill, monitor):
    pressure = monitor.get_pressure_level()

    if pressure == "HIGH":
        # Unload completed workflow modules
        unload_completed_modules(skill)

    elif pressure == "CRITICAL":
        # Unload all but essential modules
        unload_all_except_core(skill)

        # Consider summarizing and context reset
        if monitor.current_tokens > monitor.mecw_threshold * 0.8:
            summarize_session()
            reset_context()
```

**When to Use:**
- Long sessions with growing context
- Multiple workflows executed sequentially
- MECW pressure approaching limits

**Strategy:**
```python
def prioritize_for_unloading(modules):
    # Unload in this order:
    priorities = {
        "completed": 1,      # Finished workflows
        "optional": 2,       # Nice-to-have modules
        "edge-case": 3,      # Rarely used features
        "common": 4,         # Keep as long as possible
        "core": float('inf') # Never unload
    }

    return sorted(modules, key=lambda m: priorities[m.type])
```

## Advanced Patterns

### 6. Dependency Resolution

Load required dependencies automatically.

**Pattern:**
```yaml
# modules/api-review.md frontmatter
---
module_name: api-review
dependencies:
  - error-patterns  # From leyline
  - design-principles
optional_dependencies:
  - performance-patterns  # Only if performance review requested
---
```

```python
def load_with_dependencies(module_name, skill_path, loaded=None):
    if loaded is None:
        loaded = set()

    if module_name in loaded:
        return  # Already loaded

    # Load dependencies first
    module = read_module_metadata(skill_path, module_name)
    for dep in module.dependencies:
        load_with_dependencies(dep, skill_path, loaded)

    # Load the module itself
    load_module(skill_path, module_name)
    loaded.add(module_name)
```

**When to Use:**
- Modules have shared foundational content
- Want to avoid duplicate content across modules
- Complex module relationships

### 7. Caching and Memoization

Cache loaded modules for fast re-loading.

**Pattern:**
```python
class ModuleCache:
    def __init__(self):
        self._cache = {}
        self._access_count = {}

    def get_module(self, module_path):
        if module_path not in self._cache:
            self._cache[module_path] = self._load_from_disk(module_path)
            self._access_count[module_path] = 0

        self._access_count[module_path] += 1
        return self._cache[module_path]

    def evict_least_used(self, keep_count=5):
        # Keep most frequently accessed modules
        sorted_modules = sorted(
            self._access_count.items(),
            key=lambda x: x[1],
            reverse=True
        )

        for module_path, _ in sorted_modules[keep_count:]:
            del self._cache[module_path]
            del self._access_count[module_path]
```

**When to Use:**
- Modules are expensive to load
- Same modules loaded repeatedly
- Want to optimize performance

### 8. Incremental Loading

Load large modules in chunks.

**Pattern:**
```markdown
# modules/large-reference.md

## Core Concepts
[Load first - 200 tokens]

## Common Patterns
[Load on request - 500 tokens]

## Complete Reference
[Load only if needed - 2000 tokens]
```

```python
def load_incremental(module_path, section=None):
    if section is None:
        # Load just the overview
        return load_section(module_path, "Core Concepts")
    else:
        # Load specific section
        return load_section(module_path, section)

# Usage
core = load_incremental("large-reference.md")  # 200 tokens
if need_more_detail:
    patterns = load_incremental("large-reference.md", "Common Patterns")  # +500 tokens
if need_complete:
    full = load_incremental("large-reference.md", "Complete Reference")  # +2000 tokens
```

**When to Use:**
- Individual modules are very large
- Most uses need only part of module
- Want to support both quick reference and deep dives

## Implementation Utilities

### Module Metadata

```yaml
# Every module should have frontmatter
---
module_name: git-patterns
skill: catchup
priority: common
estimated_tokens: 450
dependencies: []
optional_dependencies: [advanced-git]
triggers:
  keywords: [git, commit, branch]
  artifacts: [.git/]
mutually_exclusive_with: [document-patterns]
load_strategy: lazy
cache_ttl: 3600
---
```

### Loading Protocol

```python
from leyline import MECWMonitor, estimate_tokens

class ModuleLoader:
    def __init__(self, skill_path):
        self.skill_path = skill_path
        self.loaded = {}
        self.monitor = MECWMonitor()

    def load(self, module_name, strategy="lazy"):
        # Check if already loaded
        if module_name in self.loaded:
            return self.loaded[module_name]

        # Check MECW compliance
        module_path = f"{self.skill_path}/modules/{module_name}.md"
        tokens = estimate_tokens(module_path)

        can_load, issues = self.monitor.can_handle_additional(tokens)
        if not can_load:
            raise ModuleLoadError(f"Cannot load {module_name}: {issues}")

        # Load based on strategy
        if strategy == "lazy":
            content = self._load_on_access(module_path)
        elif strategy == "eager":
            content = self._load_immediately(module_path)
        elif strategy == "incremental":
            content = self._load_core_only(module_path)

        # Track and return
        self.loaded[module_name] = content
        self.monitor.track_usage(self.monitor.current_tokens + tokens)
        return content

    def unload(self, module_name):
        if module_name in self.loaded:
            del self.loaded[module_name]
```

## Best Practices

1. **Always Load Core**: Hub SKILL.md should always load minimum viable content
2. **Document Load Triggers**: Make it clear when/why modules load
3. **Respect MECW**: Check budget before loading any module
4. **Prefer Lazy**: Load on-demand unless eager loading clearly better
5. **Cache Smartly**: Cache frequently accessed, stable modules
6. **Measure Reality**: Track which modules actually get loaded in practice
7. **Fail Gracefully**: Provide degraded functionality if module won't load

## Anti-Patterns

**Eager Loading Everything**: Defeats progressive loading purpose
**Complex Load Logic**: If loading is hard to debug, simplify
**Ignoring Dependencies**: Load dependencies before dependents
**No Unloading**: Memory/context grows unbounded
**Silent Load Failures**: User should know if module unavailable
**Circular Dependencies**: Modules should form DAG, not cycles

## Integration Examples

### With Imbue Catchup

```markdown
# catchup/SKILL.md

## Progressive Loading

**Git Catchup**: Load `modules/git-catchup-patterns.md`
- Triggers: git commands, branch mentions, commit analysis
- Dependencies: leyline:mecw-patterns, sanctum:git-workspace-review

**Document Catchup**: Load `modules/document-analysis-patterns.md`
- Triggers: markdown files, meeting notes, sprint docs
- Dependencies: leyline:progressive-loading

**Log Catchup**: Load `modules/log-analysis-patterns.md`
- Triggers: log files, time-series data, event streams
- Dependencies: leyline:mecw-patterns
```

### With Conservation Context-Optimization

```markdown
# context-optimization/SKILL.md

## Progressive Loading

**MECW Assessment**: Always loaded (core module)
**Subagent Coordination**: Load when complexity high or context critical
**Advanced Optimization**: Load when MODERATE+ pressure detected
```

### With Abstract Modular-Skills

```markdown
# modular-skills/SKILL.md

## Progressive Loading

**Core Workflow**: Always loaded - hub-and-spoke overview
**Implementation Patterns**: Load when user designing/implementing
**Migration Guide**: Load when user has existing monolithic skill
**Troubleshooting**: Load on explicit request or validation failures
```

## Validation Checklist

- [ ] Hub SKILL.md defines all loading contexts
- [ ] Each module has frontmatter with loading metadata
- [ ] Dependencies declared and resolved correctly
- [ ] MECW compliance checked before loading
- [ ] Unloading strategy defined for long sessions
- [ ] Cache strategy appropriate for module access patterns
- [ ] Loading failures handled gracefully
- [ ] Performance measured (load time, token cost)
