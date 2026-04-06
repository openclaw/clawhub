# Testing Templates

Reusable test patterns for skills and scripts.

## Unit Test Scaffold

```python
"""Test module for [component]."""
import pytest
from pathlib import Path

# Fixtures
@pytest.fixture
def sample_skill_path(tmp_path: Path) -> Path:
    """Create a minimal valid skill for testing."""
    skill_dir = tmp_path / "test-skill"
    skill_dir.mkdir()

    skill_md = skill_dir / "SKILL.md"
    skill_md.write_text("""---
name: test-skill
description: Test skill for validation. Use when testing validation logic.
---

# Test Skill

Test content.
""")
    return skill_md


@pytest.fixture
def invalid_skill_path(tmp_path: Path) -> Path:
    """Create an invalid skill for testing error handling."""
    skill_dir = tmp_path / "invalid-skill"
    skill_dir.mkdir()

    skill_md = skill_dir / "SKILL.md"
    skill_md.write_text("No frontmatter")
    return skill_md


# Test classes
class TestValidation:
    """Tests for validation functionality."""

    def test_valid_skill_passes(self, sample_skill_path: Path):
        """Valid skills should pass validation."""
        result = validate(sample_skill_path)
        assert result.is_valid
        assert not result.errors

    def test_invalid_skill_fails(self, invalid_skill_path: Path):
        """Invalid skills should fail with clear errors."""
        result = validate(invalid_skill_path)
        assert not result.is_valid
        assert len(result.errors) > 0

    def test_error_messages_are_helpful(self, invalid_skill_path: Path):
        """Error messages should include suggestions."""
        result = validate(invalid_skill_path)
        for error in result.errors:
            assert error.suggestion is not None
```

## Integration Test Pattern

```python
"""Integration tests for [workflow]."""
import subprocess
from pathlib import Path


class TestWorkflow:
    """End-to-end workflow tests."""

    def test_full_validation_workflow(self, skill_directory: Path):
        """Test complete validation workflow."""
        # Run the validator
        result = subprocess.run(
            ["python", "scripts/validator.py", str(skill_directory)],
            capture_output=True,
            text=True
        )

        # Check exit code
        assert result.returncode == 0

        # Check output
        assert "Validation passed" in result.stdout

    def test_workflow_with_errors(self, invalid_directory: Path):
        """Test workflow handles errors gracefully."""
        result = subprocess.run(
            ["python", "scripts/validator.py", str(invalid_directory)],
            capture_output=True,
            text=True
        )

        # Should fail but not crash
        assert result.returncode in [1, 2]
        assert "error" in result.stderr.lower() or "error" in result.stdout.lower()
```

## Mock Fixtures

```python
"""Common mock fixtures."""
import pytest
from unittest.mock import Mock, patch


@pytest.fixture
def mock_filesystem():
    """Mock filesystem operations."""
    with patch('pathlib.Path.exists') as mock_exists:
        with patch('pathlib.Path.read_text') as mock_read:
            yield {'exists': mock_exists, 'read_text': mock_read}


@pytest.fixture
def mock_skill_data() -> dict:
    """Standard skill frontmatter for testing."""
    return {
        'name': 'test-skill',
        'description': 'Test skill for validation. Use when testing.',
        'version': '1.0.0',
        'category': 'testing',
        'tags': ['test', 'validation'],
    }
```

## Parameterized Tests

```python
@pytest.mark.parametrize("name,expected_valid", [
    ("valid-name", True),
    ("also-valid-123", True),
    ("Invalid_Name", False),  # Underscore not allowed
    ("UPPERCASE", False),     # Must be lowercase
    ("with spaces", False),   # Spaces not allowed
    ("a" * 65, False),        # Too long
])
def test_name_validation(name: str, expected_valid: bool):
    """Test name field validation with various inputs."""
    result = validate_name(name)
    assert result.is_valid == expected_valid
```

## Assertion Helpers

```python
def assert_valid_skill(skill_path: Path):
    """Assert that a skill passes all validation."""
    result = validate(skill_path)
    assert result.is_valid, f"Validation failed: {result.errors}"
    assert not result.warnings, f"Unexpected warnings: {result.warnings}"


def assert_error_contains(result: ValidationResult, code: str):
    """Assert that result contains a specific error code."""
    codes = [e.code for e in result.errors]
    assert code in codes, f"Expected error {code}, got {codes}"
```
