---
name: handoff-patterns
description: Request formulation templates and documentation patterns for delegating tasks to external LLMs
parent_skill: conjure:delegation-core
category: delegation-framework
estimated_tokens: 180
dependencies:
  - leyline:service-registry
  - leyline:authentication-patterns
---

# Handoff Patterns and Request Formulation

## Suitability Evaluation

**Check Prerequisites:**
- [ ] Authenticate and verify external service is reachable
- [ ] Confirm quota/rate limits have capacity for the task
- [ ] Verify task does not involve sensitive data requiring local processing
- [ ] Verify expected output format is well-defined

**Evaluate Service Fit:**
- Does the external model excel at this task type?
- Is the latency acceptable for the workflow?
- Can results be easily validated?

## Request Formulation

**Four-Step Process:**
1. Write a clear, self-contained prompt
2. Include all necessary context (files, constraints, examples)
3. Specify the exact output format expected
4. Define success criteria for validation

## Delegation Plan Template

```markdown
## Delegation Plan
- **Service**: [Gemini CLI / Qwen MCP / Other]
- **Command/Call**: [Exact invocation]
- **Input Context**: [Files, data provided]
- **Expected Output**: [Format, content type]
- **Validation Method**: [How to verify correctness]
- **Contingency**: [What to do if delegation fails]
```

## Execution and Integration

**Execute:**
1. Run the delegation with the planned command
2. Capture full output (save to file for audit trail)
3. Log usage metrics (tokens, duration, success/failure)

**Validate:**
- Does output match the expected format?
- Are results factually plausible?
- Do code suggestions compile/lint?
- Are there obvious errors or hallucinations?

**Integrate:**
- Apply results only after validation
- Document what was delegated and the outcome
- Note lessons learned for future delegations

## Collaborative Workflows

For complex tasks requiring both intelligence AND scale:

```
1. Claude: Define framework, criteria, evaluation rubric
2. External: Process data, extract patterns, generate candidates
3. Claude: Analyze results, make decisions, provide recommendations
```

**Example - Large Codebase Review:**
1. Claude: Define architectural principles to evaluate
2. Gemini: Catalog all modules, extract dependency graphs
3. Claude: Analyze patterns against principles, recommend changes

## Anti-Patterns vs Good Patterns

**Don't Delegate:**
- "Review this code and tell me if it's good" (intelligence task)
- "What's the best architecture for X?" (strategic decision)
- "Fix the bugs in this file" (requires understanding intent)

**Do Delegate:**
- "List all functions in these 50 files" (extraction)
- "Count occurrences of pattern X across codebase" (counting)
- "Generate boilerplate for these 20 endpoints" (templating)
