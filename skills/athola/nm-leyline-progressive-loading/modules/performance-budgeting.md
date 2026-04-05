# Performance Budgeting for Skills

Optimize Claude Code plugin performance through token budgeting and context-aware content delivery.

## Token Budget Model

### Budget Allocation (Claude Code v2.1.32+)

| Context Window | Budget (2%) | Per-Skill Target | Max Skills |
|---------------|-------------|-------------------|------------|
| 200k tokens | ~16,000 chars | 300-500 chars | ~40 |
| 1M tokens | ~20,000 chars | up to 160 chars | ~74 |

The `SLASH_COMMAND_TOOL_CHAR_BUDGET` env var overrides the default. The ecosystem validator uses 20,000 (matching 1M context GA).

### Per-Skill Targets

| Skill Size | Token Range | Strategy |
|-----------|-------------|----------|
| Minimal | <300 tokens | Single SKILL.md, no modules |
| Standard | 300-800 tokens | SKILL.md + 1-2 modules |
| Large | 800-1500 tokens | Progressive loading required |
| Oversize | >1500 tokens | Split into separate skills |

## Core Principles

1. **Metadata-first discovery** - Claude scans ~100 tokens of frontmatter to decide relevance before loading full content
2. **Progressive disclosure** - Essential content loads immediately; advanced content lives in modules loaded on-demand
3. **Token budgeting** - Track and enforce per-skill token limits aligned with the ecosystem budget
4. **Context-aware delivery** - Load depth matches task complexity

## Optimization Workflow

### Step 1: Measure
```bash
python plugins/abstract/scripts/validate_budget.py
```

### Step 2: Identify Reduction Targets
- Move examples and edge cases to modules
- Compress repetitive patterns into tables
- Remove content duplicated from dependencies
- Replace verbose explanations with concise rules

### Step 3: Restructure
- Extract sections >200 tokens into `modules/`
- Ensure SKILL.md frontmatter description stays under 500 characters
- Add `progressive_loading: true` to frontmatter
- List modules in frontmatter `modules:` array

### Step 4: Validate
```bash
python plugins/abstract/scripts/validate_budget.py
# Target: 50%+ reduction from original
```

## Quality Checks

Before finalizing optimization:

- [ ] SKILL.md frontmatter description is under 500 characters
- [ ] Quick Start section provides enough info for basic use
- [ ] All modules are listed in frontmatter `modules:` array
- [ ] `estimated_tokens` in frontmatter reflects actual measured value
- [ ] `progressive_loading: true` is set when modules exist
- [ ] No functionality lost - advanced content accessible via modules
- [ ] Token reduction target met (50%+ for large skills)

## References

- **ADR 0004: Skill Description Budget** - The 2% budget rule scales with context window size
- **Context Optimization** (`conserve:context-optimization`) - MECW principles for context management
