# Test Generation Module

## Overview

Automated test scaffolding and generation following TDD/BDD principles. Creates test templates that developers complete using proper TDD workflow.

## Generation Strategies

See [generation/strategies](generation/strategies.md) for:
- Code analysis approaches
- Git change detection
- API-based generation

## Test Templates

See [generation/templates](generation/templates.md) for:
- Function test templates
- Class test templates
- API test templates

## Smart Features

See [generation/smart-features](generation/smart-features.md) for:
- Parameter discovery
- Error scenario generation
- Context-aware patterns

## Workflow

1. **Analyze**: Parse code structure and dependencies
2. **Discover**: Identify test scenarios and edge cases
3. **Generate**: Create test scaffolding with BDD patterns
4. **Review**: Validate generated tests
5. **Complete**: Developer finishes with TDD cycle

## Best Practices

### Do Generate
- Test scaffolding with TODO comments
- BDD-style structure templates
- Parameterized test skeletons
- Mock/stub setup patterns

### Don't Generate
- Actual test implementations
- Complex assertions
- Business logic
- Mock behavior (too specific)
