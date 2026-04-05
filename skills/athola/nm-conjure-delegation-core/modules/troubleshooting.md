---
name: troubleshooting
description: Common delegation problems and solutions for quality control, service failures, and integration issues
parent_skill: conjure:delegation-core
category: delegation-framework
estimated_tokens: 150
dependencies:
  - leyline:error-patterns
---

# Delegation Troubleshooting Guide

## Delegation Decision Issues

**Problem: Uncertain whether to delegate**
- **Solution**: Use the decision matrix. If high intelligence required, keep local.
- **Check**: Does this task require understanding intent, context, or making judgments?

**Problem: Delegated task produces poor results**
- **Common Causes**:
  - Task was actually high-intelligence (reclassify)
  - Instructions were ambiguous (make more specific)
  - Context was insufficient (add more examples)
  - Wrong tool for the job (try different service)

**Problem: External service fails unexpectedly**
- **Immediate**: Default to local processing
- **Investigation**: Check authentication, quotas, service status
- **Prevention**: Validate prerequisites before delegation

## Quality Control Issues

**Problem: Can't validate delegated results**
- **Solution**: Break task into smaller, verifiable chunks
- **Alternative**: Include self-validation in the delegation prompt
- **Prevention**: Always define success criteria before delegating

**Problem: Results integrate poorly**
- **Common Causes**:
  - Output format mismatch (specify exact format)
  - Style inconsistencies (provide style examples)
  - Missing context (include integration patterns)

## Service-Specific Issues

**Problem: Quota exhaustion**
- **Immediate**: Pause delegations, check quota status
- **Long-term**: Implement quota monitoring and throttling
- **See**: `Skill(leyline:quota-management)` for tracking patterns

**Problem: Authentication failures**
- **Check**: API keys, environment variables, service
  status
- **Verify**: Token expiration, permission scopes
- **See**: `Skill(leyline:authentication-patterns)` for
  setup

**Problem: SDK caller account metadata missing**
- **Context**: Early telemetry events may lack account
  info due to async initialization
- **Solution (2.1.51+)**: Set these env vars before
  launching Claude Code to provide account info
  synchronously:
  - `CLAUDE_CODE_ACCOUNT_UUID` - account identifier
  - `CLAUDE_CODE_USER_EMAIL` - user email address
  - `CLAUDE_CODE_ORGANIZATION_UUID` - organization ID
- **Benefit**: Eliminates race condition where early
  events lack metadata

**Problem: Rate limiting**
- **Solution**: Implement exponential backoff
- **Prevention**: Track request patterns, batch when possible
- **See**: `Skill(leyline:error-patterns)` for retry strategies

## Integration Failures

**Problem: Output doesn't match expected format**
- **Solution**: Validate schema before integration
- **Fix**: Update prompt with explicit format examples
- **Secondary Strategy**: Manual transformation or re-delegation

**Problem: Partial results returned**
- **Check**: Context window limits, timeout settings
- **Solution**: Break into smaller chunks
- **Alternative**: Use streaming if supported

**Problem: Results conflict with existing code**
- **Prevention**: Include existing patterns in delegation context
- **Solution**: Manual reconciliation with validation
- **Long-term**: Improve context specification
