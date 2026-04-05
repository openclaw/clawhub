# Generation Strategies Module

## Overview

Different approaches for discovering what needs testing and generating appropriate test scaffolding.

## From Code Analysis

Analyzes existing code to generate appropriate test scaffolding.

```python
def generate_tests_from_code(code_path):
    """Generate test scaffolding from code analysis."""

    # Parse the code
    ast_tree = ast.parse(open(code_path).read())

    # Extract testable elements
    functions = extract_functions(ast_tree)
    classes = extract_classes(ast_tree)

    # Generate test templates
    for func in functions:
        generate_function_test_template(func)

    for cls in classes:
        generate_class_test_template(cls)
```

## From Git Changes

Generates tests for new or modified code.

```python
def generate_tests_for_changes(git_diff):
    """Generate tests based on git changes."""

    changes = parse_git_diff(git_diff)

    for change in changes:
        if change.type == 'new_function':
            generate_new_function_test(change)
        elif change.type == 'modified_signature':
            generate_updated_test(change)
        elif change.type == 'new_class':
            generate_class_test_suite(change)
```

## From API Definitions

Generates integration tests from API contracts or OpenAPI specs.

```python
def generate_api_tests(openapi_spec):
    """Generate BDD-style API tests from OpenAPI spec."""

    for endpoint in openapi_spec.paths:
        for method in endpoint.methods:
            generate_endpoint_test(endpoint, method)
```

## Strategy Selection

Choose based on your needs:
- **Code Analysis**: For existing code without tests
- **Git Changes**: For recent modifications
- **API Definitions**: For contract-first development
