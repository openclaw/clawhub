# Command-Skill Matrix

## Overview

The Command-Skill Matrix defines which skills are required for each speckit command, ensuring proper dependencies are loaded and coordinated throughout the workflow.

## Complete Mapping

### Specification Phase

**`/speckit-specify`**
- **Primary Skill**: `spec-writing`
- **Complementary Skills**: `superpowers:brainstorming`
- **Loading Order**: brainstorming → spec-writing
- **When to Load**: At command start, before any specification work
- **Purpose**: Create or refine feature specifications with collaborative ideation

**`/speckit-clarify`**
- **Primary Skill**: `spec-writing`
- **Complementary Skills**: `superpowers:brainstorming`
- **Loading Order**: brainstorming → spec-writing
- **When to Load**: When specification needs refinement or has gaps
- **Purpose**: Identify underspecified areas and encode clarifications

**`/speckit-constitution`**
- **Primary Skill**: `spec-writing`
- **Complementary Skills**: None required
- **Loading Order**: spec-writing only
- **When to Load**: Creating or updating project principles
- **Purpose**: Establish project governance and design principles

### Planning Phase

**`/speckit-plan`**
- **Primary Skill**: `task-planning`
- **Complementary Skills**: `superpowers:writing-plans`
- **Loading Order**: task-planning → writing-plans
- **When to Load**: After specification is complete
- **Purpose**: Generate detailed implementation design artifacts

**`/speckit-tasks`**
- **Primary Skill**: `task-planning`
- **Complementary Skills**: `superpowers:executing-plans`
- **Loading Order**: task-planning → executing-plans
- **When to Load**: After planning artifacts exist
- **Purpose**: Generate dependency-ordered implementation tasks

### Implementation Phase

**`/speckit-implement`**
- **Primary Skill**: None (uses loaded plan)
- **Complementary Skills**: `superpowers:executing-plans`, `superpowers:systematic-debugging`
- **Loading Order**: executing-plans → systematic-debugging (on-demand)
- **When to Load**: When executing tasks from tasks.md
- **Purpose**: Execute implementation tasks with error handling

### Verification Phase

**`/speckit-analyze`**
- **Primary Skill**: None (analysis only)
- **Complementary Skills**: `superpowers:systematic-debugging`, `superpowers:verification-before-completion`
- **Loading Order**: Load both at analysis start
- **When to Load**: After task generation or implementation
- **Purpose**: Cross-artifact consistency and quality analysis

**`/speckit-checklist`**
- **Primary Skill**: None (generation only)
- **Complementary Skills**: `superpowers:verification-before-completion`
- **Loading Order**: verification-before-completion only
- **When to Load**: When generating feature-specific checklists
- **Purpose**: Create custom verification checklists

**`/speckit-startup`**
- **Primary Skill**: None (bootstrap only)
- **Complementary Skills**: None required
- **Loading Order**: N/A
- **When to Load**: Session initialization
- **Purpose**: Bootstrap workflow and verify environment

## Skill Loading Priorities

### High Priority (Always Load First)
1. `spec-writing` - For any specification work
2. `task-planning` - For any planning work

### Medium Priority (Load After Primary)
3. `superpowers:brainstorming` - For ideation phases
4. `superpowers:writing-plans` - For detailed planning
5. `superpowers:executing-plans` - For implementation

### Low Priority (Load On-Demand)
6. `superpowers:systematic-debugging` - When errors occur
7. `superpowers:verification-before-completion` - For final checks

## Conditional Loading Rules

- **Brainstorming**: Only load if specification is new or incomplete
- **Systematic Debugging**: Only load if implementation encounters errors
- **Verification**: Only load for analyze/checklist commands or before completion
- **Writing Plans**: Only load if creating new implementation plans

## Skill Interaction Patterns

### Specification → Planning
- Specification skills complete → task-planning loads
- Hand off spec.md to planning phase

### Planning → Implementation
- Planning skills complete → executing-plans loads
- Hand off tasks.md to implementation phase

### Implementation → Verification
- Implementation errors → systematic-debugging loads
- Implementation complete → verification-before-completion loads
