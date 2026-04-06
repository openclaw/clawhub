# Manifest Parsing Module

Parse `.manifest.yaml` files and tape file annotations for tutorial orchestration.

## Manifest Schema

Tutorial manifests define multi-component tutorials with composition rules:

```yaml
# Full manifest schema
name: string              # Required: identifier for the tutorial
title: string             # Optional: human-readable title
description: string       # Optional: brief description

components:               # Required: list of media components
  - type: tape            # Component type: tape, playwright, static
    source: path/to.tape  # Path to source file (relative to manifest)
    output: path/to.gif   # Path for generated output
    options:              # Optional: component-specific options
      fps: 10
      width: 800

  - type: playwright
    source: browser/spec.ts
    output: assets/gifs/browser.gif
    requires:             # Optional: commands to run before
      - "npm run serve"

  - type: static          # Pre-existing asset (no generation)
    source: existing.gif
    output: existing.gif

combine:                  # Optional: composition rules
  output: combined.gif    # Path for combined output
  layout: vertical        # Layout: vertical, horizontal, sequential, grid, pip
  options:
    padding: 10
    background: "#1a1a2e"
```

## Component Types

### Tape Components

VHS tape files for terminal recordings:

```yaml
- type: tape
  source: quickstart.tape
  output: assets/gifs/quickstart.gif
  options:
    # Override tape file settings if needed
    width: 1000
    height: 500
```

### Playwright Components

Browser automation specs:

```yaml
- type: playwright
  source: browser/mcp-dashboard.spec.ts
  output: assets/gifs/mcp-browser.gif
  requires:
    - "skrills serve"
  options:
    fps: 12
    width: 1280
```

The `requires` array specifies commands to run before the spec. These run as background processes and are terminated after recording.

### Static Components

Pre-existing assets that don't need generation:

```yaml
- type: static
  source: diagrams/architecture.gif
  output: diagrams/architecture.gif
```

## Parsing Tape File Annotations

Tape files contain inline annotations for documentation generation:

### Annotation Format

```tape
# @title: Tutorial Title
# @description: Brief description for README

# @step Step Name
# @docs-brief Concise text for project docs
# @book-detail Extended explanation for technical book
Type "command"
Enter
```

### Annotation Types

| Annotation | Scope | Purpose |
|------------|-------|---------|
| `@title` | File | Tutorial title |
| `@description` | File | Brief description |
| `@step` | Block | Step heading |
| `@docs-brief` | Block | Concise docs text |
| `@book-detail` | Block | Extended book text |

### Parsing Algorithm

```python
def parse_tape_annotations(tape_content: str) -> dict:
    """Parse tape file for documentation annotations."""
    result = {
        "title": None,
        "description": None,
        "steps": []
    }

    current_step = None

    for line in tape_content.splitlines():
        line = line.strip()

        # File-level annotations
        if line.startswith("# @title:"):
            result["title"] = line.split(":", 1)[1].strip()
        elif line.startswith("# @description:"):
            result["description"] = line.split(":", 1)[1].strip()

        # Step-level annotations
        elif line.startswith("# @step"):
            # Save previous step
            if current_step:
                result["steps"].append(current_step)
            # Start new step
            step_name = line.replace("# @step", "").strip()
            current_step = {
                "name": step_name,
                "docs_brief": None,
                "book_detail": None,
                "commands": []
            }
        elif line.startswith("# @docs-brief"):
            if current_step:
                current_step["docs_brief"] = line.replace("# @docs-brief", "").strip()
        elif line.startswith("# @book-detail"):
            if current_step:
                current_step["book_detail"] = line.replace("# @book-detail", "").strip()

        # Command lines (Type, Enter, etc.)
        elif current_step and line.startswith("Type"):
            # Extract command text
            match = re.match(r'Type(?:@\d+ms)?\s+"(.+)"', line)
            if match:
                current_step["commands"].append(match.group(1))

    # Don't forget last step
    if current_step:
        result["steps"].append(current_step)

    return result
```

## Manifest Validation

### Required Fields

```bash
# Validate manifest has required fields
yq eval '.name' manifest.yaml >/dev/null || echo "ERROR: missing name"
yq eval '.components | length > 0' manifest.yaml | grep -q true || echo "ERROR: no components"

# Validate each component
for i in $(seq 0 $(($(yq eval '.components | length' manifest.yaml) - 1))); do
  yq eval ".components[$i].type" manifest.yaml >/dev/null || echo "ERROR: component $i missing type"
  yq eval ".components[$i].source" manifest.yaml >/dev/null || echo "ERROR: component $i missing source"
  yq eval ".components[$i].output" manifest.yaml >/dev/null || echo "ERROR: component $i missing output"
done
```

### Source File Validation

```bash
# Check all source files exist
for source in $(yq eval '.components[].source' manifest.yaml); do
  if [[ ! -f "$source" ]]; then
    echo "ERROR: Source file not found: $source"
  fi
done
```

## Discovery Patterns

### Find All Manifests

```bash
# Find manifest files in common locations
find . -name "*.manifest.yaml" -type f \
  -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" \
  2>/dev/null
find assets -name "*.manifest.yaml" -type f 2>/dev/null
find tutorials -name "*.manifest.yaml" -type f 2>/dev/null
```

### Find Standalone Tape Files

Tape files without manifests (single-component tutorials):

```bash
# Find tape files
find . -name "*.tape" -type f \
  -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" \
  2>/dev/null

# Filter out those with manifests
for tape in $(find . -name "*.tape" -type f \
  -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" \
  2>/dev/null); do
  manifest="${tape%.tape}.manifest.yaml"
  if [[ ! -f "$manifest" ]]; then
    echo "Standalone: $tape"
  fi
done
```

### Build Tutorial Index

```bash
# Create index of all tutorials
echo "Tutorials:"
echo "=========="

# From manifests
for manifest in $(find . -name "*.manifest.yaml" -type f \
  -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" \
  2>/dev/null); do
  name=$(yq eval '.name' "$manifest")
  title=$(yq eval '.title // .name' "$manifest")
  components=$(yq eval '.components | length' "$manifest")
  echo "  $name: $title ($components components) [manifest]"
done

# Standalone tapes
for tape in $(find . -name "*.tape" -type f \
  -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" \
  2>/dev/null); do
  manifest="${tape%.tape}.manifest.yaml"
  if [[ ! -f "$manifest" ]]; then
    name=$(basename "$tape" .tape)
    echo "  $name: $tape [standalone]"
  fi
done
```

## Error Handling

| Error | Resolution |
|-------|------------|
| Manifest parse error | Validate YAML syntax with `yq eval '.' manifest.yaml` |
| Missing source file | Check path is relative to manifest location |
| Unknown component type | Use `tape`, `playwright`, or `static` |
| Missing combine output | Add `combine.output` field if combine section exists |
| Circular requires | validate background processes don't depend on each other |

## Example Manifests

### Simple Tape Tutorial

```yaml
name: quickstart
title: "Quickstart Guide"
components:
  - type: tape
    source: quickstart.tape
    output: assets/gifs/quickstart.gif
```

### Multi-Component Tutorial

```yaml
name: mcp
title: "MCP Server Integration"
description: "Terminal and browser demo of MCP server"
components:
  - type: tape
    source: mcp-terminal.tape
    output: assets/gifs/mcp-terminal.gif
  - type: playwright
    source: browser/mcp-dashboard.spec.ts
    output: assets/gifs/mcp-browser.gif
    requires:
      - "skrills serve"
combine:
  output: assets/gifs/mcp-combined.gif
  layout: vertical
  options:
    padding: 10
    background: "#0d1117"
```

### Tutorial with Static Assets

```yaml
name: architecture
title: "Architecture Overview"
components:
  - type: tape
    source: arch-demo.tape
    output: assets/gifs/arch-demo.gif
  - type: static
    source: diagrams/system-overview.gif
    output: diagrams/system-overview.gif
combine:
  output: assets/gifs/architecture-full.gif
  layout: sequential
```
