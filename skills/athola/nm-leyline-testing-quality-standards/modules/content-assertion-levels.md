# Content Assertion Levels

## Why Content Assertions Exist

Markdown files under `skills/`, `agents/`, `modules/`, and `commands/` are execution markdown -- Claude Code interprets them as behavioral instructions, not static documentation. When these files contain broken JSON schemas, stale version references, or manipulative language, Claude produces broken outputs or harmful behaviors.

Content assertions catch these problems before users encounter them. The guiding question: "If this content were wrong, what would Claude do incorrectly?"

## The Three Levels

### Level 1: Keyword Presence

Validates that required sections, terminology, and module references exist.

```python
assert "## When To Use" in skill_content
assert "pre-invocation" in module_content.lower()
```

Cheapest to write. Catches structural regressions (missing sections, dropped references) but not semantic errors (wrong JSON schema, stale version).

### Level 2: Code Example Validity

Parses embedded code examples and validates structure. Catches broken examples that Claude would copy verbatim into user configurations.

```python
# Extract and validate all JSON code blocks
blocks = re.findall(r"```json\n(.*?)```", content, re.DOTALL)
for block in blocks:
    parsed = json.loads(block)  # Must parse without error

# Validate schema structure
assert "matcher" in hook_def
assert hook_def["type"] in ("command", "http")
```

Also covers: YAML frontmatter parsing, version string extraction with regex, section extraction for targeted validation.

### Level 3: Behavioral Contracts

Validates semantic correctness across documents and ensures the content teaches Claude correct behavior.

**Cross-reference validation**: Version strings referenced in one document must exist in compatibility docs.

```python
versions = re.findall(r"2\.1\.(\d+)", module_content)
compat_texts = [p.read_text() for p in compat_dir.glob("compatibility-features*.md")]
compat_content = "\n".join(compat_texts)
for v in versions:
    assert f"2.1.{v}" in compat_content
```

**Anti-pattern detection**: Forbidden language that causes Claude to ignore user intent.

```python
forbidden = ["MANDATORY AUTO-CONTINUATION", "YOU MUST EXECUTE THIS NOW"]
for phrase in forbidden:
    assert phrase not in skill_content
```

**Decision framework completeness**: Skills must offer multiple strategies, not force one path.

```python
strategies = ["/clear", "/catchup", "auto-compact", "continuation"]
found = [s for s in strategies if s.lower() in content.lower()]
assert len(found) >= 3
```

## When to Apply Each Level

| Content Type | Minimum Level | L3 Required When |
|---|---|---|
| Skill SKILL.md (simple) | L1 | Cross-references other docs |
| Skill with code examples | L2 | Code examples are templates Claude copies |
| Skill with decision frameworks | L2 | Always -- decisions affect user outcomes |
| Module with version gates | L2 | Always -- wrong versions break features |
| Agent definitions | L1 | Defines forbidden or required behaviors |

## Test Class Conventions

- Name content assertion classes with a `Content` suffix: `TestSubagentCoordinationModuleContent`
- State the level in the class docstring: `Level 2: Version references are internally consistent.`
- Use `@pytest.mark.bdd` and `@pytest.mark.unit` markers
- Use `Path(__file__).parents[N]` for relative path resolution to skill files
- Fixtures: `skill_path` returns the `Path`, `skill_content` calls `.read_text()`

## What NOT to Test with Content Assertions

- Prose style or word choice (use `scribe:slop-detector` instead)
- Exact wording that makes tests brittle to rewording
- Line counts or file sizes (not behavioral)
- Formatting or whitespace

## Exemplars

Three test classes established the taxonomy in practice:

| Test Class | Plugin | Levels | Key Patterns |
|---|---|---|---|
| `TestHookAuthoringHttpHooks` | abstract | L2+L3 | JSON schema validation, version cross-reference to compatibility docs |
| `TestClearContextSkillContent` | conserve | L1+L3 | Forbidden manipulative language, multiple recovery strategies |
| `TestSubagentCoordinationModuleContent` | conserve | L2+L3 | Section extraction via regex, delegation framework contracts |

File locations:
- `plugins/abstract/tests/test_skill_structure.py`
- `plugins/conserve/tests/unit/skills/test_clear_context.py`
- `plugins/conserve/tests/unit/skills/test_context_optimization.py`
