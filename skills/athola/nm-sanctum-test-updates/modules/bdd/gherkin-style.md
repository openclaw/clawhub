# Gherkin BDD Style Module

## Overview

Feature files with Given/When/Then scenarios for complex user workflows and cross-team collaboration.

## Feature File Structure

```gherkin
Feature: Git Workflow Management
  As a developer
  I want to automate git workflows
  So that I can maintain clean commit history

  Scenario: Commit with staged changes
    Given a git repository with staged changes
    When I run the commit workflow
    Then a commit should be created with proper message
    And all tests should pass

  Scenario Outline: Multiple file types
    Given a git repository with staged <file_type> files
    When I run the commit workflow
    Then the commit should reference <file_type>
    And the commit type should be <commit_type>

    Examples:
      | file_type | commit_type |
      | source    | feat       |
      | test      | test       |
      | docs      | docs       |
```

## Step Definitions

```python
@given('a git repository with staged changes')
def step_given_git_repo_with_changes(context):
    context.repo = create_test_repo()
    context.repo.stage_changes(['file1.py', 'file2.py'])

@when('I run the commit workflow')
def step_when_run_commit_workflow(context):
    context.result = run_commit_workflow(context.repo)

@then('a commit should be created with proper message')
def step_then_commit_created(context):
    assert context.repo.has_commit()
    assert context.repo.last_commit_message().startswith('feat:')
```

## When to Use

- Complex user workflows
- Acceptance criteria documentation
- Cross-team collaboration
- Living documentation requirements
