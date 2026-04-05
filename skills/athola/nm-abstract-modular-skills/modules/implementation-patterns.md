---
name: implementation-patterns
description: Implementation patterns and best practices for building modular skills with consistent architecture and maintainable code
category: implementation
tags: [implementation-patterns, modular-skills, best-practices, code-organization, development]
dependencies: [modular-skills]
tools: []
complexity: intermediate
estimated_tokens: 900
---

# Modular Skills Implementation Patterns

This document covers the implementation patterns we use for our modular skills. We follow these patterns to validate that our skills are easy to understand, maintain, and use.

## Phase 3: Implementing the Skill

### The Progressive Disclosure Structure

We design our skills around the idea of "progressive disclosure." This means that we start with a high-level overview and then provide more detail as needed. This allows users to get the information they need without being overwhelmed with detail.

Here's how we structure our skills:

- **Level 1: Metadata (the YAML frontmatter in `SKILL.md`)**: This is the first thing a user sees. It should provide a one-line summary of what the skill does, as well as other key information like the category, tags, dependencies, and tools.

    ```yaml
    ---
    name: skill-name
    description: One-line summary
    category: workflow-type
    tags: [relevant, tags]
    dependencies: [skill-dependency1, skill-dependency2]
    scripts: [script1, script2]
    usage_patterns: [pattern1, pattern2]
    complexity: beginner|intermediate|advanced
    estimated_tokens: number
    ---
    ```

- **Level 2: Overview (the body of `SKILL.md`)**: This section provides a bit more detail. It should include a quick start guide, a "when to use" section, a list of available scripts, and links to other resources.

- **Level 3: Detailed Workflow (`guide.md`)**: This is where you'll find the step-by-step instructions for using the skill. It should include code examples and guidance for resolving common issues.

- **Level 4: Executable Scripts (`scripts/`)**: This directory contains any automation scripts, validation utilities, or analysis tools that are part of the skill.

### Script Integration

We believe that the most capable skills are those that integrate with scripts to automate tasks. When we build scripts, we follow these guidelines:

- They should be executable from the command line.
- They should be self-contained and have a clear interface.
- They should be documented with usage examples.
- They should be tested for security and performance.

## Phase 4: Documentation, Validation, and Measuring Success

Once the skill is implemented, we move on to the final phase: documentation, validation, and measuring success.

### Documentation

We create clear documentation for our skills so that others can understand how to use them. This includes:

- When to load each module
- How the modules interact with each other
- What the secondary options are if a primary one is not available
- Common ways to use the skill

### Validation

Before we deploy a new skill, we validate it to make sure it's working as expected. We use the `module_validator` tool for this.

```bash
module_validator --skill-path . --check-dependencies
```

The validator checks for:

- Completeness of the frontmatter
- Availability of dependencies
- Functionality of the scripts
- Accuracy of the token usage estimation

We also have a testing strategy that includes unit tests for our scripts, integration tests for our workflows, token usage validation, and performance benchmarking.

### Measuring Success

We look at both quantitative and qualitative measures to determine if a skill is successful.

On the quantitative side, we look for:

- A reduction in token usage (we aim for at least a 30% reduction)
- An improvement in load time
- A reduction in maintenance overhead
- How often the skill is reused across different projects

On the qualitative side, we look for:

- How easy it is for our developers to use the skill
- How easy it is to find the skill
- How clear the documentation is
- How widely the skill is adopted within our team

To get started with the modular skills design process, refer to the core workflow documentation for guidance on scope evaluation and architecture design.
