---
name: core-workflow
description: Primary workflow for designing and building modular skills with systematic evaluation and architecture patterns
category: workflow
tags: [core-workflow, modular-skills, skill-design, architecture, evaluation]
dependencies: [modular-skills]
tools: [skill-analyzer]
complexity: intermediate
estimated_tokens: 800
---

# The Core Workflow for Modular Skills

This is our core workflow for designing and building modular skills. We follow this process to validate that our skills are well-designed, maintainable, and efficient.

## Phase 1: Evaluating the Scope

Before we start building, we first evaluate the scope of the skill. This helps us decide if the skill should be modularized and how it fits into our existing skill architecture.

### Complexity Analysis

The first step is to analyze the complexity of the proposed skill. We use the `skill-analyzer` tool to help with this.

```bash
skill-analyzer --path path/to/skill --threshold 150
```

We look at a few key metrics:

- **Line count**: If the skill is more than 150 lines, it's a good candidate for modularization.
- **Theme coverage**: If the skill covers more than three distinct themes, we'll break it up.
- **Token footprint**: A skill with a token footprint of more than 2KB is another sign that it should be modularized.
- **Overlap detection**: If the skill shares workflows with other skills, we'll look for opportunities to extract those shared workflows into a separate module.

### Dependency Mapping

Next, we map out any existing workflows that could be shared. This includes things like:

- ADR templates and processes
- Git workflows (commit messages, PR templates, review patterns)
- Testing patterns (unit, integration, and end-to-end)
- Documentation standards

### Token Usage Estimation

Finally, we estimate the token usage of the proposed skill. The `token-estimator` tool can help with this.

```bash
token-estimator --file skill.md --include-dependencies
```

## Phase 2: Designing the Module Architecture

Once we've evaluated the scope, we move on to designing the module architecture.

### The Hub-and-Spoke Pattern

We use a "hub-and-spoke" pattern for our modular skills. This means we have a primary "hub" skill that contains the core metadata and an overview, and then optional "spoke" submodules that contain more detailed information.

Here’s an example of what the structure looks like:

```
skill-category/
├── SKILL.md (this is the hub, with metadata and an overview)
├── guide.md (this is a spoke, with a detailed workflow)
├── scripts/ (this is a spoke, with related scripts)
│   ├── analyzer.py
│   └── validator.py
└── examples/ (this is a spoke, with examples)
    ├── basic-implementation/
    └── advanced-patterns/
```

### Naming Conventions

We use consistent prefixes for our skills to make them easier to find and understand. For example:

- `architecture-paradigm-*` for architectural patterns
- `testing-*` for testing workflows
- `documentation-*` for documentation standards
- `workflow-*` for process automation

### Dependency Rules

We follow a few simple rules for dependencies:

- **Maximum depth of 2 levels**: We stick to a simple `hub -> module` structure and avoid any deeper nesting.
- **No circular dependencies**: A hub can depend on a module, but a module can't depend on a hub.
- **Explicit dependency declaration**: All dependencies must be declared in the skill's frontmatter.
- **Default behavior for missing dependencies**: If a dependency is missing, the skill should still function, even if it's in a limited capacity.

Once you've designed your architecture, you can move on to implementation patterns for more detailed guidance.
