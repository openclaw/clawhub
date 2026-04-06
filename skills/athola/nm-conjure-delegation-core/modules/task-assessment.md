---
name: task-assessment
description: Task classification framework for determining delegation suitability based on intelligence level and context requirements
parent_skill: conjure:delegation-core
category: delegation-framework
estimated_tokens: 200
dependencies:
  - leyline:quota-management
---

# Task Assessment for Delegation

## Intelligence Level Classification

**High Intelligence (Keep Local):**
- Architecture analysis
- Design decisions
- Trade-off evaluation
- Strategic recommendations
- Nuanced code review
- Creative problem solving

**Low Intelligence (Delegate):**
- Pattern counting
- Bulk extraction
- Boilerplate generation
- Large-file summarization
- Repetitive transformations

## Context Requirements

**Large Context (Favor Delegation):**
- Multi-file analysis
- Codebase-wide searches
- Log processing

**Small Context (Either):**
- Single-file operations
- Focused queries

## Decision Matrix

| Intelligence | Context | Recommendation |
|-------------|---------|----------------|
| High | Any | Keep local |
| Low | Large | Delegate |
| Low | Small | Either |

## Assessment Checklist

Record the following for each task:
- [ ] **Task Objective**: What needs to be accomplished?
- [ ] **Files Involved**: How many and what size?
- [ ] **Intelligence Level**: High or Low?
- [ ] **Context Size**: Large or Small?
- [ ] **Failure Impact**: What happens if delegation fails?

## Token Usage Estimates

**Low Intelligence Tasks (Good for Delegation):**
- Pattern counting across files: 10-50 tokens/file
- Bulk data extraction: 20-100 tokens/file
- Boilerplate generation: 100-500 tokens/template
- Large file summarization: 1-5% of file size tokens

**Context Size Estimations:**
- Single Python file (500 lines): ~2,000-3,000 tokens
- Small module (10 files): ~15,000-25,000 tokens
- Medium project (50 files): ~75,000-150,000 tokens
- Large codebase (200+ files): 300,000+ tokens

**Delegation Thresholds:**
- **Efficient to delegate**: >25,000 total tokens or >50 files
- **Consider delegation**: 10,000-25,000 tokens or 20-50 files
- **Keep local**: <10,000 tokens and <20 files

## Red Flags (Stay Local)

- Security-sensitive operations (auth, crypto, secrets)
- Tasks requiring real-time iteration
- Complex multi-step reasoning chains
- Subjective quality judgments
