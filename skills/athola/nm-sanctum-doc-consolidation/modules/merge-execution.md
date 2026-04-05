# Merge Execution Module

Executes the approved consolidation plan, performing actual file operations.

## Execution Order

1. **Group by destination** - Minimize file I/O
2. **Process creates first** - New files before updates
3. **Process updates** - Apply merges to existing files
4. **Delete sources** - Remove after successful consolidation
5. **Generate summary** - Report all changes

## Pre-Execution Checks

Before any file operations:

```python
def pre_execution_checks(plan: ConsolidationPlan) -> list[str]:
    """Validate plan is safe to execute. Returns errors."""
    errors = []

    # Check all destinations are writable
    for route in plan.routes:
        dest_dir = Path(route.destination).parent
        if not dest_dir.exists():
            # Will create - check parent is writable
            if not os.access(dest_dir.parent, os.W_OK):
                errors.append(f"Cannot create directory: {dest_dir}")
        elif not os.access(route.destination, os.W_OK):
            errors.append(f"Cannot write to: {route.destination}")

    # Check sources exist and are readable
    for source in plan.sources:
        if not Path(source).exists():
            errors.append(f"Source not found: {source}")

    # Check for conflicting operations
    destinations = [r.destination for r in plan.routes]
    if len(destinations) != len(set(destinations)):
        # Multiple chunks going to same file - need ordering
        pass  # This is fine, handled by grouping

    return errors
```

## Strategy Implementations

### CREATE_NEW

```python
def execute_create_new(route: Route) -> ExecutionResult:
    """Create a new file with content."""

    # validate directory exists
    dest_path = Path(route.destination)
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    # Generate content based on category
    if route.chunk.category == 'decisions':
        content = generate_adr_content(route)
    elif route.chunk.category == 'actionable':
        content = generate_plan_content(route)
    else:
        content = generate_doc_content(route)

    # Write file
    dest_path.write_text(content)

    return ExecutionResult(
        destination=route.destination,
        action='created',
        bytes_written=len(content),
    )
```

### INTELLIGENT_WEAVE

```python
def execute_intelligent_weave(route: Route) -> ExecutionResult:
    """Insert content into matching section of existing file."""

    dest_path = Path(route.destination)
    original = dest_path.read_text()

    # Find matching section
    section_pattern = find_matching_section(original, route.chunk.header)

    if not section_pattern:
        # Fall back to append
        return execute_append_with_context(route)

    # Analyze existing style
    style = analyze_section_style(original, section_pattern)

    # Format new content to match
    formatted = format_to_match_style(route.chunk.content, style)

    # Insert at appropriate location within section
    updated = insert_in_section(original, section_pattern, formatted)

    # Validate result
    if not validate_markdown(updated):
        raise ExecutionError(f"Weave produced invalid markdown for {route.destination}")

    dest_path.write_text(updated)

    return ExecutionResult(
        destination=route.destination,
        action='weaved',
        section=section_pattern.header,
        bytes_added=len(formatted),
    )

def analyze_section_style(content: str, section: SectionMatch) -> Style:
    """Determine formatting style of existing section."""
    section_content = extract_section_content(content, section)

    return Style(
        uses_bullets=bool(re.search(r'^[-*]\s', section_content, re.M)),
        uses_numbers=bool(re.search(r'^\d+\.\s', section_content, re.M)),
        uses_tables=bool(re.search(r'^\|.*\|$', section_content, re.M)),
        indent_style=detect_indent(section_content),
        has_blank_lines='\n\n' in section_content,
    )
```

### REPLACE_SECTION

```python
def execute_replace_section(route: Route) -> ExecutionResult:
    """Replace entire section with new content."""

    dest_path = Path(route.destination)
    original = dest_path.read_text()

    # Find section boundaries
    section = find_section_boundaries(original, route.target_section)

    if not section:
        raise ExecutionError(f"Section '{route.target_section}' not found in {route.destination}")

    # Log what we're replacing (for rollback if needed)
    replaced_content = original[section.start:section.end]
    log_replacement(route.destination, route.target_section, replaced_content)

    # Build replacement with update marker
    replacement = f"{section.header}\n\n"
    replacement += f"*Updated: {date.today().isoformat()} (consolidated from {route.source})*\n\n"
    replacement += route.chunk.content

    # Replace in document
    updated = original[:section.start] + replacement + original[section.end:]

    dest_path.write_text(updated)

    return ExecutionResult(
        destination=route.destination,
        action='replaced',
        section=route.target_section,
        bytes_before=len(replaced_content),
        bytes_after=len(replacement),
    )
```

### APPEND_WITH_CONTEXT

```python
def execute_append_with_context(route: Route) -> ExecutionResult:
    """Add new section at end of document."""

    dest_path = Path(route.destination)
    original = dest_path.read_text()

    # Determine section level (match document)
    header_level = detect_header_level(original)

    # Build new section
    new_section = f"\n\n{'#' * header_level} {route.chunk.header}"
    new_section += f" (consolidated {date.today().isoformat()})\n\n"
    new_section += f"*Source: {route.source}*\n\n"
    new_section += route.chunk.content

    # Append
    updated = original.rstrip() + new_section + "\n"

    dest_path.write_text(updated)

    return ExecutionResult(
        destination=route.destination,
        action='appended',
        section=route.chunk.header,
        bytes_added=len(new_section),
    )
```

## Source Deletion

After all merges complete successfully:

```python
def delete_sources(plan: ConsolidationPlan, results: list[ExecutionResult]) -> list[str]:
    """Delete source files after successful consolidation."""

    # Only delete if ALL operations succeeded
    if any(r.status == 'failed' for r in results):
        return []  # Don't delete anything

    deleted = []
    for source in plan.sources:
        source_path = Path(source)
        if source_path.exists():
            source_path.unlink()
            deleted.append(source)

    return deleted
```

## Rollback Support

Maintain log for potential rollback:

```python
CONSOLIDATION_LOG = '.consolidation-log.json'

def log_operation(operation: dict):
    """Log operation for potential rollback."""
    log_path = Path(CONSOLIDATION_LOG)

    if log_path.exists():
        log = json.loads(log_path.read_text())
    else:
        log = {'operations': [], 'timestamp': datetime.now().isoformat()}

    log['operations'].append(operation)
    log_path.write_text(json.dumps(log, indent=2))

def rollback_last():
    """Rollback most recent consolidation."""
    log_path = Path(CONSOLIDATION_LOG)
    if not log_path.exists():
        raise RollbackError("No consolidation log found")

    log = json.loads(log_path.read_text())

    # Reverse operations
    for op in reversed(log['operations']):
        if op['action'] == 'created':
            Path(op['destination']).unlink()
        elif op['action'] == 'replaced':
            restore_section(op['destination'], op['section'], op['original'])
        elif op['action'] == 'deleted':
            # Cannot restore deleted sources automatically
            print(f"WARNING: Cannot restore deleted source: {op['source']}")

    log_path.unlink()
```

## Execution Summary

Generate detailed summary:

```markdown
# Consolidation Complete

**Timestamp**: 2025-12-06T14:32:15
**Duration**: 2.3s

## Created Files (3)

| File | Size | Category |
|------|------|----------|
| docs/api-overview.md | 1,847 bytes | findings |
| docs/plans/2025-12-06-api-consistency.md | 1,456 bytes | actionable |
| docs/adr/0002-2025-12-06-cli-naming.md | 634 bytes | decisions |

## Updated Files (1)

| File | Section | Strategy | Change |
|------|---------|----------|--------|
| docs/architecture.md | Consistency | APPEND | +892 bytes |

## Deleted Sources (1)

- ~~API_REVIEW_REPORT.md~~ (deleted)

## Verification Checklist

- [ ] Review created files for accuracy
- [ ] Check weaved content fits naturally
- [ ] Run documentation build (if applicable)
- [ ] Commit changes

**Suggested commit message:**
```
docs: consolidate API review findings

- Created api-overview.md with plugin API inventory
- Created plan for API consistency improvements
- Added ADR for CLI naming convention
- Updated architecture.md with consistency findings

Consolidated from: API_REVIEW_REPORT.md
```
```

## Error Handling

```python
class ExecutionError(Exception):
    """Error during merge execution."""
    pass

def execute_with_recovery(plan: ConsolidationPlan) -> ExecutionSummary:
    """Execute plan with error recovery."""
    results = []

    try:
        # Execute creates
        for route in plan.creates:
            result = execute_create_new(route)
            log_operation(result.to_dict())
            results.append(result)

        # Execute updates
        for route in plan.updates:
            if route.strategy == 'INTELLIGENT_WEAVE':
                result = execute_intelligent_weave(route)
            elif route.strategy == 'REPLACE_SECTION':
                result = execute_replace_section(route)
            else:
                result = execute_append_with_context(route)

            log_operation(result.to_dict())
            results.append(result)

        # Delete sources
        deleted = delete_sources(plan, results)
        for source in deleted:
            log_operation({'action': 'deleted', 'source': source})

        return ExecutionSummary(results=results, deleted=deleted, status='success')

    except Exception as e:
        # Log failure but don't auto-rollback
        return ExecutionSummary(
            results=results,
            status='partial_failure',
            error=str(e),
            message="Some operations failed. Use rollback if needed."
        )
```
