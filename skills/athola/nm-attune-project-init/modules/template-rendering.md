# Template Rendering Module

Render templates with collected metadata and copy to project.

## Template Variables

Available in all templates:

```python
{
    "PROJECT_NAME": "my-awesome-project",       # Project name with hyphens
    "PROJECT_MODULE": "my_awesome_project",     # Python module name (underscores)
    "AUTHOR": "Alex Thola",                     # Author name
    "EMAIL": "alex@example.com",                # Author email
    "PYTHON_VERSION": "3.12",                   # Python version (e.g., "3.12")
    "PYTHON_VERSION_SHORT": "312",              # Short version (e.g., "312")
    "LICENSE": "MIT",                           # License type
    "DESCRIPTION": "A CLI tool",                # Short description
    "YEAR": "2026",                             # Current year
}
```

## Template Syntax

Use simple `{{VARIABLE}}` replacement:

```toml
# pyproject.toml.template
[project]
name = "{{PROJECT_NAME}}"
version = "0.1.0"
description = "{{PROJECT_DESCRIPTION}}"
authors = [
    {name = "{{AUTHOR}}", email = "{{EMAIL}}"}
]
```

## Rendering Process

### 1. Find Templates

```bash
TEMPLATE_DIR="plugins/attune/templates/python"
find "$TEMPLATE_DIR" -name "*.template"
```

### 2. Process Each Template

```python
from template_engine import TemplateEngine

engine = TemplateEngine(variables)

for template_path in template_files:
    # Calculate output path (remove .template extension)
    output_path = str(template_path).replace(".template", "")

    # Render template
    engine.render_file(template_path, output_path)
```

### 3. Handle Conflicts

If output file exists:

```
File exists: pyproject.toml

Options:
  1. Skip (keep existing)
  2. Overwrite (replace with template)
  3. Diff (show differences)
  4. Merge (combine both) [Not implemented yet]

Choice [1-4]:
```

## Safety Checks

### Before Rendering

- ✅ Check output file doesn't exist (unless --force)
- ✅ Validate all template variables are provided
- ✅ Check write permissions on output directory

### During Rendering

- ✅ Create parent directories if needed
- ✅ Log each file created
- ✅ Track success/failure for each template

### After Rendering

- ✅ Verify all expected files created
- ✅ Check file permissions are correct
- ✅ Run basic validation (e.g., `make help`)

## Error Handling

**Template variable missing**:
```python
# In template: {{UNKNOWN_VAR}}
# Result: Leaves {{UNKNOWN_VAR}} unchanged (visible in output)
# Better: Raise error before rendering
```

**Write permission denied**:
```python
try:
    output_path.write_text(rendered)
except PermissionError:
    print(f"✗ Permission denied: {output_path}")
    print("  Try: chmod +w .")
```

**Directory creation fails**:
```python
try:
    output_path.parent.mkdir(parents=True, exist_ok=True)
except OSError as e:
    print(f"✗ Cannot create directory: {e}")
```

## Post-Rendering Actions

### Python Projects

1. **Create source structure**:
   ```python
   src_dir = Path("src") / metadata["PROJECT_MODULE"]
   src_dir.mkdir(parents=True, exist_ok=True)

   (src_dir / "__init__.py").write_text(
       f'"""{{metadata["PROJECT_MODULE"]}} package."""\n\n'
       f'__version__ = "0.1.0"\n'
   )
   ```

2. **Create tests directory**:
   ```python
   tests_dir = Path("tests")
   tests_dir.mkdir(exist_ok=True)
   (tests_dir / "__init__.py").write_text("")
   ```

3. **Initialize README** (if doesn't exist):
   ```python
   readme = Path("README.md")
   if not readme.exists():
       readme.write_text(f"# {metadata['PROJECT_NAME']}\n\n...")
   ```

## Validation

After all templates rendered:

```bash
# Check Makefile works
make help

# Check git status
git status

# Verify directory structure
tree -L 2
```

## Success Criteria

- ✅ All templates rendered without errors
- ✅ No unresolved template variables in output
- ✅ All directories created successfully
- ✅ File permissions correct (644 for files, 755 for directories)
- ✅ `make help` runs successfully

## Examples

### Example 1: Successful Rendering

```
Rendering templates...
  ✓ .gitignore
  ✓ pyproject.toml
  ✓ Makefile
  ✓ .pre-commit-config.yaml
  ✓ .github/workflows/test.yml
  ✓ .github/workflows/lint.yml
  ✓ .github/workflows/typecheck.yml

Creating project structure...
  ✓ src/my_awesome_project/__init__.py
  ✓ tests/__init__.py
  ✓ README.md

All templates rendered successfully!
```

### Example 2: Handling Conflicts

```
Rendering templates...
  ✓ .gitignore
  ⊘ pyproject.toml (skipped - file exists)
  ? Makefile
    File exists. Overwrite? [y/N]: n
  ⊘ Makefile (skipped - user declined)
  ✓ .pre-commit-config.yaml
  ...
```
