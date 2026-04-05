---
name: session-palace-builder
description: Build session-scoped temporary knowledge structures for multi-step projects
version: 1.8.1
triggers:
  - session
  - context
  - project-memory
  - conversation-state
  - temporary-storage
  - working on complex tasks spanning turns
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/memory-palace", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.memory-palace-architect"]}}}
source: claude-night-market
source_plugin: memory-palace
---

> **Night Market Skill** — ported from [claude-night-market/memory-palace](https://github.com/athola/claude-night-market/tree/master/plugins/memory-palace). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [What It Is](#what-it-is)
- [Quick Start](#quick-start)
- [Mental Model](#mental-model)
- [When to Use](#when-to-use)
- [Session Palace Templates](#session-palace-templates)
- [Information Categories](#information-categories)
- [Core Workflow](#core-workflow)
- [Session Lifecycle](#session-lifecycle)
- [Detailed Resources](#detailed-resources)
- [Integration](#integration)


# Session Palace Builder

Construct temporary, session-specific memory palaces for extended conversations and complex projects. Preserves context across interruptions and enables structured information accumulation.

## What It Is

Session palaces are lightweight, temporary memory structures that:
- Preserve context for extended conversations
- Track decisions and their rationale
- Organize project artifacts spatially
- Enable context recovery after interruptions
- Support collaborative information gathering

## Quick Start

### Build Commands
\`\`\`bash
# Run build
make build

# Clean and rebuild
make clean && make build
\`\`\`

### Testing
\`\`\`bash
# Run tests
make test

# Run with verbose output
make test VERBOSE=1
\`\`\`

**Verification**: Run `make build && make test` to confirm build works.
## When To Use

- Extended conversations requiring context preservation
- Complex, multi-step projects with interrelated components
- Workflows requiring state management across interactions
- Collaborative sessions accumulating information over time
- Code review or debugging sessions with many findings

## When NOT To Use

- Permanent knowledge structures
  needed - use memory-palace-architect
- Searching existing knowledge
  - use knowledge-locator
- Permanent knowledge structures
  needed - use memory-palace-architect
- Searching existing knowledge
  - use knowledge-locator

## Session Palace Templates

| Template | Purpose | Key Areas |
|----------|---------|-----------|
| **Workshop** | Active development | Workbench, tools, materials |
| **Library** | Research and analysis | Stacks, reading room, archives |
| **Council Chamber** | Decision-making | Round table, evidence wall, vote board |
| **Observatory** | Exploration and discovery | Telescope, star charts, log book |
| **Forge** | Implementation tasks | Anvil, cooling rack, finished goods |

## Information Categories

Organize session content into these standard areas:

- **Conversations** - Dialogue threads and key exchanges
- **Decisions** - Choices made with rationale
- **Code** - Snippets and technical artifacts
- **Research** - Findings and references
- **Requirements** - Specifications and constraints
- **Progress** - Completed milestones
- **Issues** - Blockers and challenges
- **Next Steps** - Pending action items

## Core Workflow

1. **Analyze Context** - Assess session scope and complexity
2. **Design Palace** - Select template and layout
3. **Structure State** - Organize information spatially
4. **Build Navigation** - Create access shortcuts
5. **Test Integration** - Verify context preservation

## Session Lifecycle

```
Create → Populate → Navigate → Export/Archive
   ↑         ↓          ↓
   └─── Checkpoint ←────┘
```
**Verification:** Run the command with `--help` flag to verify availability.

## Detailed Resources

- **Template Details**: See `modules/templates.md`
- **State Management**: See `modules/templates.md`
- **Export Patterns**: See `modules/templates.md`

## Integration

- `memory-palace-architect` - Export important concepts to permanent palaces
- `knowledge-locator` - Search session content
- `digital-garden-cultivator` - Seed garden with session insights
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
