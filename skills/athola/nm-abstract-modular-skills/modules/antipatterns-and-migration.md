---
name: antipatterns-and-migration
description: Common anti-patterns in modular skill development and migration strategies for improving existing monolithic skills
category: refactoring
tags: [antipatterns, migration, modular-skills, refactoring, best-practices]
dependencies: [modular-skills]
tools: [skill-analyzer]
complexity: advanced
estimated_tokens: 1000
---

# Modular Skills Anti-Patterns and Migration

This document covers the common anti-patterns we've seen when building modular skills, and how to migrate away from them.

## Anti-Patterns to Avoid

When we first started building skills, we made a few mistakes. Here are some of the things we learned to avoid.

- **Monolithic Skills**: We used to have single, large files that covered multiple themes. This made them difficult to maintain and understand.
- **Deeply Nested Modules**: We also had complex dependency chains, with modules that depended on other modules, which in turn depended on other modules. This made it hard to track dependencies and led to a lot of complexity.
- **Implicit Dependencies**: We didn't always declare our dependencies explicitly. This made it difficult to know what a skill needed to run.
- **Content Duplication**: Instead of referencing shared content, we would copy it between modules. This led to a lot of duplicated effort and inconsistencies.
- **Poor Naming**: Our naming conventions were inconsistent, which made it hard to find and understand our skills.

### Warning Signs

Here are a few warning signs that a skill might not be as modular as it could be:

- The skill file is larger than 2KB.
- The skill covers more than three main themes.
- The same instructions are repeated across multiple skills.
- There are complex import chains.
- It's not clear when to use specific modules.

## Migration Guide

If you have existing skills that are not as modular as they could be, you can use this guide to help you migrate them to our modular design patterns.

### Converting Existing Skills

1.  **Analyze**: The first step is to run a complexity analysis on the existing skill. This will help you identify the different themes and concerns that are covered by the skill.
2.  **Extract**: Once you've identified the different themes, you can start to extract them into separate modules with clear boundaries.
3.  **Modularize**: Now you can create the new modular structure, with a hub skill and separate modules for each theme.
4.  **Document**: It's important to update all the references and call patterns to reflect the new modular structure.
5.  **Validate**: Finally, you should test the new modular structure to make sure everything is working as expected.

### Maintaining Compatibility

During the transition, we recommend maintaining the original skill as a hub. This will validate that existing workflows that depend on the original skill continue to work. You should also provide documentation that explains the new modular structure and how to use it.

We recommend testing both the old and new patterns to validate that everything is working as expected. You should also monitor the token usage of the new modular structure to see if it's providing the improvements you were hoping for.

For new skills, you should start with the core workflow guidance. For more detailed implementation guidance, see the implementation patterns documentation.
