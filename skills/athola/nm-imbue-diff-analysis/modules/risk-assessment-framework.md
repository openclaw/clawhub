---
name: risk-assessment-framework
description: Framework for evaluating change risk and impact, reusable across review workflows
parent_skill: imbue:diff-analysis
category: risk-analysis
tags: [risk, impact, assessment, testing, quality]
reusable_by: [pensive:rust-review, pensive:api-review, pensive:architecture-review, pensive:bug-review]
estimated_tokens: 400
---

# Risk Assessment Framework

## Risk Indicators

Evaluate each change category for potential impact across these dimensions:

### Breaking Changes
- Public API modifications (function signatures, return types)
- Schema changes (database, data structures, serialization formats)
- Contract alterations (protocols, interfaces, message formats)
- Dependency version changes with incompatible APIs

### Security-Sensitive
- Authentication mechanisms or credential handling
- Authorization logic or permission checks
- Cryptography usage (encryption, hashing, signing)
- Input validation or sanitization
- Network communication or protocol handling

### Data Integrity
- Database operations (writes, updates, migrations)
- State management logic
- Persistence logic or serialization
- Transaction handling
- Data validation or constraints

### External Dependencies
- Third-party service integrations
- Library updates or version bumps
- API client changes
- Infrastructure dependencies (databases, queues, caches)

### Performance-Critical
- Hot paths or frequently-executed code
- Caching mechanisms
- Resource allocation (memory, file handles, connections)
- Algorithmic changes in core operations

## Risk Levels

Classify overall risk based on indicators:

- **Low**: Internal refactors, documentation updates, test additions with no production code changes
- **Medium**: Feature additions with detailed tests, non-breaking API extensions, configuration changes with rollback plans
- **High**: Breaking changes requiring coordination, security modifications, schema migrations, changes to critical paths

## Test Coverage Flagging

Identify changes requiring additional testing attention:

- **Untested Changes**: New code or modifications without corresponding test updates
- **Test-Only Changes**: Test updates without production code (potential false positives)
- **Coverage Gaps**: High-risk changes with insufficient test scenarios
- **Integration Points**: Changes affecting external systems without integration tests

## Risk Scoring Methodology

1. **Identify Indicators**: Note which risk dimensions apply to each change
2. **Count High-Risk Indicators**: Breaking, security, data integrity take precedence
3. **Assess Test Coverage**: Reduce risk level if detailed tests present
4. **Consider Scope**: Smaller, isolated changes generally lower risk than widespread modifications
5. **Assign Level**: Use conservative assessment (when in doubt, elevate risk)

## Output Format

For each high or medium risk change:
- **Change**: Brief description
- **Risk Level**: Low/Medium/High
- **Indicators**: Which dimensions triggered the assessment
- **Mitigation**: What testing/review would reduce risk
- **Dependencies**: Related changes or prerequisite work
