# Language Detection Module

Automatically detect project language or help user choose.

## Detection Strategy

### 1. Check for Language-Specific Files

**Python indicators**:
- `pyproject.toml`
- `setup.py`
- `requirements.txt`
- `Pipfile`

**Rust indicators**:
- `Cargo.toml`
- `Cargo.lock`

**TypeScript indicators**:
- `tsconfig.json`
- `package.json` with TypeScript dependencies

### 2. Scan Source Files

If no config files found, check `src/` directory:

```bash
# Count file types
find src -name "*.py" | wc -l
find src -name "*.rs" | wc -l
find src -name "*.ts" -o -name "*.tsx" | wc -l
```

Language with most files wins.

### 3. Ask User

If still ambiguous:

```
Unable to auto-detect project language.

Please select:
  1. Python
  2. Rust
  3. TypeScript/React

Choice [1-3]:
```

## Implementation

Use `project_detector.py`:

```python
from project_detector import ProjectDetector

detector = ProjectDetector(Path.cwd())
language = detector.detect_language()

if not language:
    # Ask user
    print("Select language:")
    print("  1. Python")
    print("  2. Rust")
    print("  3. TypeScript")
    choice = input("Choice [1-3]: ")
    language = ["python", "rust", "typescript"][int(choice) - 1]
```

## Output

Set language variable for subsequent modules:
- `LANGUAGE` = "python" | "rust" | "typescript"

## Edge Cases

- **Multiple languages detected**: Ask user which is primary
- **No source files**: Default to Python (most common for new projects)
- **Mixed JavaScript/TypeScript**: Prefer TypeScript if tsconfig.json exists
