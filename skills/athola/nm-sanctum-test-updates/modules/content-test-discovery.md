# Content Test Discovery

Detects when modified markdown files are "execution markdown" requiring content assertions, and identifies test gaps.

## Execution Markdown Detection

Files matching ALL of these criteria are execution markdown:

1. File extension is `.md`
2. Path contains `skills/`, `agents/`, `modules/`, or `commands/`
3. File is NOT named `README.md`, `CHANGELOG.md`, or located under `docs/` directories

```python
def is_execution_markdown(file_path: str) -> bool:
    """Markdown that Claude interprets as behavioral instructions."""
    path = Path(file_path)
    exec_dirs = {"skills", "agents", "modules", "commands"}
    skip_names = {"README.md", "CHANGELOG.md"}
    return (
        path.suffix == ".md"
        and any(d in path.parts for d in exec_dirs)
        and path.name not in skip_names
        and "docs" not in path.parts
    )
```

## Priority Reclassification

Override the default test-discovery priority scoring for execution markdown:

| Change Type | Priority | Rationale |
|---|---|---|
| `SKILL.md` modified | **High** | Directly drives Claude's behavior |
| Module `.md` modified | **Medium** | Loaded on-demand, affects specific workflows |
| Agent `.md` modified | **Medium** | Defines agent behavior and constraints |
| Command `.md` modified | **Low-Medium** | Affects slash command documentation |
| README, CHANGELOG | Low | Not interpreted by Claude as instructions |

## Test Gap Detection

When execution markdown is modified, check for a corresponding content test class.

### Naming Convention

| Source File | Expected Test Location |
|---|---|
| `plugins/<plugin>/skills/<name>/SKILL.md` | `plugins/<plugin>/tests/unit/skills/test_<name_underscored>.py` |
| `plugins/<plugin>/skills/<name>/modules/<mod>.md` | `plugins/<plugin>/tests/unit/skills/test_<name_underscored>.py` |
| `plugins/<plugin>/agents/<name>.md` | `plugins/<plugin>/tests/unit/test_<name_underscored>.py` |

### Detection Heuristic

Look for existing content test classes by checking:

1. Test file exists at the expected path
2. File contains a class ending in `Content` (e.g., `TestClearContextSkillContent`)
3. File contains fixtures that read `.md` files (e.g., `skill_content`, `module_content`)

If no content test class exists, flag as a content test gap.

## When to Generate vs. Skip

Not every markdown change needs new content tests.

### Generate Content Tests When

- A new skill or module is created (no existing tests)
- Code examples (JSON, YAML, Python) are added or modified (L2 needed)
- Version references are added or changed (L3 cross-reference needed)
- Decision frameworks or behavioral guidance is modified (L3 contract needed)
- Forbidden behavior patterns are specified (L3 anti-pattern detection needed)

### Skip Content Tests When

- Typo or grammar fix only (no behavioral change)
- Whitespace or formatting changes
- Changes to prose that don't affect decision logic
- Changes already covered by `scribe:slop-detector` (style, not behavior)

## Integration

This module is loaded during Phase 1 (Discovery) of the test-updates workflow. It extends git-based change detection to recognize execution markdown as high-priority test targets.

Reference: `leyline:testing-quality-standards/modules/content-assertion-levels.md` for the L1/L2/L3 taxonomy that determines which level of tests to generate.
