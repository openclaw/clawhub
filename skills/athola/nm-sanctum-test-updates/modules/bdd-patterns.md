# BDD Patterns Module

## Overview

Provides multiple Behavior-Driven Development styles and patterns for creating expressive, behavior-focused tests.

## Available Styles

### 1. Gherkin Feature Files
See [bdd/gherkin-style](bdd/gherkin-style.md) for:
- Complex user workflows
- Acceptance criteria documentation
- Cross-team collaboration

### 2. BDD-Style pytest
See [bdd/pytest-style](bdd/pytest-style.md) for:
- Unit tests with behavior focus
- API testing
- Service layer testing

### 3. Docstring BDD
See [bdd/docstring-style](bdd/docstring-style.md) for:
- Simple unit tests
- Internal module testing
- Quick behavior documentation

## Choosing the Right Style

### Decision Guide

| Style | Best For | Complexity | Collaboration |
|-------|----------|------------|----------------|
| Gherkin | Complex workflows, documentation | High | Excellent |
| BDD-pytest | Unit/API tests, developer focus | Medium | Good |
| Docstring BDD | Simple tests, quick docs | Low | Limited |

### Mixing Styles
- Use Gherkin for critical user journeys
- Use BDD-pytest for unit and API tests
- Use Docstring BDD for simple utilities
- Maintain consistency within modules

## Best Practices

### Naming Conventions
- **Tests**: `test_[behavior]_[when]_[expected]`
- **Given/When/Then**: Clear separation of concerns
- **Scenarios**: Describe business value, not technical details

### Test Organization
Group related BDD scenarios in test classes with clear setup and teardown.
