---
name: architecture-aware-init
description: |
  Architecture-aware project initialization combining online research with archetype selection
version: 1.8.1
triggers:
  - architecture
  - initialization
  - research
  - decision-making
  - best-practices
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/attune", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.architecture-paradigms"]}}}
source: claude-night-market
source_plugin: attune
---

> **Night Market Skill** — ported from [claude-night-market/attune](https://github.com/athola/claude-night-market/tree/master/plugins/attune). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [When to Use This Skill](#when-to-use-this-skill)
- [Required TodoWrite Items](#required-todowrite-items)
- [5-Step Workflow](#5-step-workflow)
- [Step 1: Gather Project Context](#step-1:-gather-project-context)
- [Step 2: Research Best Practices (`arch-init:research-completed`)](#step-2:-research-best-practices-(arch-init:research-completed))
- [Step 3: Select Architecture Paradigm (`arch-init:paradigm-selected`)](#step-3:-select-architecture-paradigm-(arch-init:paradigm-selected))
- [Step 4: Customize Templates (`arch-init:templates-customized`)](#step-4:-customize-templates-(arch-init:templates-customized))
- [Step 5: Create Architecture Decision Record (`arch-init:decision-recorded`)](#step-5:-create-architecture-decision-record-(arch-init:decision-recorded))
- [Date](#date)
- [Status](#status)
- [Context](#context)
- [Decision](#decision)
- [Rationale](#rationale)
- [Research Findings](#research-findings)
- [Key Considerations](#key-considerations)
- [Alternatives Considered](#alternatives-considered)
- [Consequences](#consequences)
- [Positive](#positive)
- [Negative](#negative)
- [Implementation](#implementation)
- [References](#references)
- [Output: Complete Initialization Package](#output:-complete-initialization-package)
- [Script Integration](#script-integration)
- [Architecture Research](#architecture-research)
- [Template Customization](#template-customization)
- [Full Interactive Flow](#full-interactive-flow)
- [Using as Library (within Claude Code)](#using-as-library-(within-claude-code))
- [Integration with Existing Commands](#integration-with-existing-commands)
- [Example Session](#example-session)
- [Related Skills](#related-skills)
- [See Also](#see-also)


# Architecture-Aware Project Initialization

## Overview

Enhanced project initialization that combines:
- **Deep online research** into current best practices for your project type
- **Archetype selection** from the 14 paradigms in the archetypes plugin
- **Template customization** based on chosen architecture
- **Decision documentation** for future reference

## When to Use This Skill

Use this skill when:
- Starting a new project and unsure which architecture fits best
- Want modern, industry-standard architecture choices
- Need justification for architectural decisions
- Want templates customized to your chosen paradigm

**Use instead of** `project-init` when architecture is undecided.
**Use before** `project-specification` to establish architectural foundation.

## Required TodoWrite Items

1. `arch-init:research-completed` - Online research completed
2. `arch-init:paradigm-selected` - Architecture paradigm chosen
3. `arch-init:templates-customized` - Templates adapted to paradigm
4. `arch-init:decision-recorded` - ADR created

## 5-Step Workflow

### Step 1: Gather Project Context

**Essential Information** (ask user):

```markdown
1. **Project Type**: What are you building?
   - Web API, CLI tool, data pipeline, desktop app, library, etc.

2. **Domain Complexity**: How complex are the business rules?
   - Simple (CRUD), Moderate (some business logic), Complex (many rules),
     Highly Complex (domain-specific language needed)

3. **Team Context**: Who will build and maintain this?
   - Team size: < 5 | 5-15 | 15-50 | 50+
   - Experience: Junior | Mixed | Senior | Expert
   - Distribution: Co-located | Remote | Distributed

4. **Non-Functional Requirements**:
   - Scalability needs (users, requests/sec, data volume)
   - Performance requirements
   - Security/compliance needs
   - Integration points (external systems, databases, APIs)

5. **Timeline & Constraints**:
   - Time to market: Rapid | Normal | Not urgent
   - Budget constraints
   - Technology constraints (must-use or must-avoid technologies)
```
**Verification:** Run the command with `--help` flag to verify availability.

### Step 2: Research Best Practices (`arch-init:research-completed`)

**Online Research Queries** (use WebSearch):

For the project type, search for:

```bash
# Primary: Architecture patterns for [project type] [year]
WebSearch("[project type] architecture best practices 2026")

# Secondary: Language-specific patterns
WebSearch("[language] [project type] architecture patterns 2026")

# Tertiary: Framework-specific guidance
WebSearch("[framework] architecture patterns [project type]")
```
**Verification:** Run the command with `--help` flag to verify availability.

**Research Focus Areas**:

1. **Current Industry Standards**: What are practitioners recommending in 2026?
2. **Emerging Patterns**: Any new architectural approaches gaining traction?
3. **Anti-Patterns**: What practices are being actively discouraged?
4. **Technology Alignment**: Which patterns work best with your chosen stack?
5. **Case Studies**: Real-world examples of similar projects

**Synthesize Findings** into:
- Recommended architecture(s) for this project type
- Key trade-offs to consider
- Red flags or anti-patterns to avoid
- Technology-specific considerations

### Step 3: Select Architecture Paradigm (`arch-init:paradigm-selected`)

**Option A: Manual Selection Using archetypes Plugin**

Invoke the architecture paradigms skill:

```
**Verification:** Run the command with `--help` flag to verify availability.
Skill(architecture-paradigms)
```
**Verification:** Run the command with `--help` flag to verify availability.

This will guide you through selecting from the 14 available paradigms:
- Layered Architecture
- Functional Core, Imperative Shell
- Hexagonal (Ports & Adapters)
- Modular Monolith
- Microservices
- Service-Based Architecture
- Event-Driven Architecture
- CQRS + Event Sourcing
- Serverless
- Space-Based Architecture
- Pipeline Architecture
- Microkernel Architecture
- Client-Server Architecture

**Option B: Automated Paradigm Matching**

Use the decision matrix below to recommend a paradigm based on project context:

```
**Verification:** Run the command with `--help` flag to verify availability.
┌─────────────────────┬─────────┬─────────┬──────────┬─────────────┐
│ Project Context     │ Simple  │ Moderate│ Complex  │ Highly      │
│                     │ Domain  │ Domain  │ Domain   │ Complex     │
├─────────────────────┼─────────┼─────────┼──────────┼─────────────┤
│ < 5 engineers       │ Layered │ Layered │ Hexagonal│ Functional  │
│                     │         │ Hexag. │ Functional│ Core        │
├─────────────────────┼─────────┼─────────┼──────────┼─────────────┤
│ 5-15 engineers      │ Layered │ Modular │ Modular  │ Hexagonal   │
│                     │         │ Monolith│ Monolith │ + FC, IS    │
├─────────────────────┼─────────┼─────────┼──────────┼─────────────┤
│ 15-50 engineers     │ Modular │ Micro-  │ Micro-   │ CQRS/ES     │
│                     │ Monolith│ services│ services │ + Event     │
├─────────────────────┼─────────┼─────────┼──────────┼─────────────┤
│ 50+ engineers       │ Micro-  │ Micro-  │ Event-   │ Microkernel │
│                     │ services│ services│ Driven   │ or Space-   │
│                     │         │ + Event │          │ Based       │
└─────────────────────┴─────────┴─────────┴──────────┴─────────────┘
```
**Verification:** Run the command with `--help` flag to verify availability.

**Special Cases**:

- **Real-time/Streaming**: Event-Driven + Pipeline
- **Bursty/Cloud-Native**: Serverless
- **Extensible Platform**: Microkernel
- **Data Processing**: Pipeline + Event-Driven
- **Legacy Integration**: Hexagonal
- **High-Throughput Stateful**: Space-Based

### Step 4: Customize Templates (`arch-init:templates-customized`)

**Template Adaptation Strategy**:

1. **Load Base Templates** for the chosen language (Python/Rust/TypeScript)
2. **Apply Architecture-Specific Modifications** based on selected paradigm
3. **Generate Custom Configuration** reflecting architectural choices
4. **Create Documentation** explaining the architecture

**Example Adaptations**:

**For Functional Core, Imperative Shell**:
```
**Verification:** Run the command with `--help` flag to verify availability.
src/
├── core/                    # Pure business logic
│   ├── domain.py           # Domain models
│   ├── operations.py       # Pure functions
│   └── commands.py         # Command objects
└── adapters/               # Side effects
    ├── database.py         # DB operations
    ├── api.py              # HTTP operations
    └── filesystem.py       # File operations
```
**Verification:** Run the command with `--help` flag to verify availability.

**For Hexagonal Architecture**:
```
**Verification:** Run the command with `--help` flag to verify availability.
src/
├── domain/                 # Business logic (no framework deps)
│   ├── models.py
│   ├── services.py
│   └── ports/             # Interfaces
│       ├── input.py       # Use cases
│       └── output.py      # Repository interfaces
└── infrastructure/        # Framework-specific code
    ├── persistence/       # Repositories
    ├── web/               # Controllers
    └── messaging/         # Event handlers
```
**Verification:** Run the command with `--help` flag to verify availability.

**For Microservices**:
```
**Verification:** Run the command with `--help` flag to verify availability.
project/
├── services/
│   ├── service-a/         # Independent service
│   │   ├── src/
│   │   ├── tests/
│   │   ├── Dockerfile
│   │   └── pyproject.toml
│   └── service-b/         # Independent service
│       ├── src/
│       ├── tests/
│       ├── Dockerfile
│       └── pyproject.toml
├── api-gateway/
├── shared/
│   └── events/
└── docker-compose.yml
```
**Verification:** Run `pytest -v` to verify tests pass.

### Step 5: Create Architecture Decision Record (`arch-init:decision-recorded`)

**Generate ADR** documenting the architecture choice:

```markdown
# Architecture Decision Record: [Paradigm Name]

## Date
[Current date]

## Status
Accepted | Proposed | Deprecated | Superseded by [link]

## Context
[Project type, team size, domain complexity, key requirements]

## Decision
[Chosen architecture paradigm]

## Rationale
### Research Findings
[Summarize online research results]

### Key Considerations
- **Team Fit**: [Why this matches team size/experience]
- **Domain Fit**: [Why this matches problem complexity]
- **Technology Fit**: [Why this works with chosen stack]
- **Scalability**: [How this addresses scaling needs]

### Alternatives Considered
1. **[Alternative 1]**: Rejected because [reason]
2. **[Alternative 2]**: Rejected because [reason]

## Consequences
### Positive
- [Benefit 1]
- [Benefit 2]

### Negative
- [Trade-off 1] with mitigation: [strategy]
- [Trade-off 2] with mitigation: [strategy]

## Implementation
- **Templates**: [Which templates were customized]
- **Key Patterns**: [Patterns to follow]
- **Anti-Patterns**: [What to avoid]
- **Resources**: [Links to paradigm skill, examples, etc.]

## References
- [Paradigm skill link]
- [Research sources]
- [Example projects]
```
**Verification:** Run the command with `--help` flag to verify availability.

## Output: Complete Initialization Package

After completing this workflow, you'll have:

1. **Project Structure**: Customized to chosen architecture
2. **Configuration**: Architecture-appropriate tooling and dependencies
3. **Documentation**: ADR explaining the architecture choice
4. **Guidance**: Links to relevant paradigm skill for implementation
5. **Examples**: Reference projects using similar architecture

## Script Integration

Claude Code can invoke the architecture research and template customization scripts:

### Architecture Research

```bash
# Run architecture researcher for recommendations
uv run python plugins/attune/scripts/architecture_researcher.py \
  --project-type web-api \
  --domain-complexity complex \
  --team-size 5-15 \
  --language python \
  --output-json
```
**Verification:** Run `python --version` to verify Python environment.

The researcher returns a recommendation with:
- Primary paradigm and rationale
- Trade-offs and mitigations
- Alternative paradigms considered
- Confidence level

### Template Customization

```bash
# Generate architecture-specific directory structure
uv run python plugins/attune/scripts/template_customizer.py \
  --paradigm cqrs-es \
  --language python \
  --project-name my-project \
  --output-dir ./my-project
```
**Verification:** Run `python --version` to verify Python environment.

This creates the paradigm-appropriate structure (e.g., commands/, queries/, events/ for CQRS).

### Full Interactive Flow

```bash
# Interactive architecture-aware initialization
uv run python plugins/attune/scripts/attune_arch_init.py \
  --name my-project \
  --lang python

# Non-interactive with explicit architecture
uv run python plugins/attune/scripts/attune_arch_init.py \
  --name my-project \
  --lang python \
  --arch hexagonal \
  --accept-recommendation
```
**Verification:** Run `python --version` to verify Python environment.

### Using as Library (within Claude Code)

```python
# Import and use programmatically
from architecture_researcher import ArchitectureResearcher, ProjectContext
from template_customizer import TemplateCustomizer

# Create context and get recommendation
context = ProjectContext(
    project_type="web-api",
    domain_complexity="complex",
    team_size="5-15",
    language="python"
)
researcher = ArchitectureResearcher(context)
recommendation = researcher.recommend()

# Apply template customization
customizer = TemplateCustomizer(
    paradigm=recommendation.primary,
    language="python",
    project_name="my-project"
)
customizer.apply_structure(Path("./my-project"))
```
**Verification:** Run the command with `--help` flag to verify availability.

## Integration with Existing Commands

This skill enhances `/attune:project-init` by adding an architecture selection phase:

```bash
# Standard initialization (no architecture decision)
/attune:project-init --lang python --name my-project

# Architecture-aware initialization
/attune:brainstorm           # Explore project needs
Skill(architecture-aware-init) # Select architecture based on research
/attune:project-init --arch <paradigm> # Initialize with chosen architecture
```
**Verification:** Run `python --version` to verify Python environment.

## Example Session

**User**: I'm creating a Python web API for a fintech application. Team of 8 developers, complex business rules, need high security and audit trails.

**Step 1 - Context**: Project type=Web API, Domain=Highly Complex, Team=5-15, Requirements=Security, Auditability

**Step 2 - Research**:
```bash
WebSearch("Python fintech API architecture patterns 2026")
WebSearch("financial services API audit trail architecture")
WebSearch("CQRS Event Sourcing Python examples")
```
**Verification:** Run `python --version` to verify Python environment.

**Step 3 - Selection**: Research + Decision Matrix → **CQRS + Event Sourcing**

**Step 4 - Templates**: Customized structure for CQRS/ES with:
- Command handling module
- Query handling module
- Event store configuration
- Aggregate patterns
- Projection handlers

**Step 5 - ADR**: Documenting why CQRS/ES for fintech (auditability, complex business rules, regulatory compliance)

**Result**: Project initialized with architecture-appropriate structure and clear decision rationale.

## Related Skills

- `Skill(architecture-paradigms)` - Comprehensive paradigm selection
- `Skill(architecture-paradigm-*)` - Specific paradigm implementation guidance
- `Skill(attune:project-brainstorming)` - Project ideation before architecture
- `Skill(attune:project-specification)` - Requirements after architecture chosen

## See Also

- `/attune:project-init` - Basic project initialization
- `/attune:blueprint` - Architecture planning after paradigm selection
- Architecture paradigms README for paradigm details
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
