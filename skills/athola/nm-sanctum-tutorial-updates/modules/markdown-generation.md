# Markdown Generation Module

Generate dual-tone markdown documentation from tape file annotations and manifest metadata.

## Dual-Tone System

Tutorials are generated in two tones for different audiences:

| Tone | Location | Audience | Style |
|------|----------|----------|-------|
| **Project Docs** | `docs/tutorials/` | Users getting started | Concise, action-oriented |
| **Technical Book** | `book/src/tutorials/` | Developers learning deeply | Detailed, educational |

## Annotation Sources

Content comes from tape file annotations:

```tape
# @step Install the CLI
# @docs-brief Install via cargo with a single command
# @book-detail The recommended installation method uses cargo, Rust's package manager. This validates you get the latest stable release with all dependencies properly resolved. For development builds or specific versions, you can also install from source.
Type "cargo install skrills"
```

- `@docs-brief` - Used for project docs (brief, focused)
- `@book-detail` - Used for technical book (extended, contextual)
- If only one is present, use it for both
- If neither is present, generate minimal text from step name

## Project Docs Format

### Template Structure

```markdown
# {Tutorial Title}

{Description from @description}

![Demo]({relative-path-to-gif})

## Prerequisites

- Prerequisite 1
- Prerequisite 2

## Steps

### {Step 1 Name}

{@docs-brief content}

```bash
{command from Type directive}
```

### {Step 2 Name}

{@docs-brief content}

```bash
{command}
```

## Next Steps

- Link to related tutorial 1
- Link to related tutorial 2
```

### Example Output

```markdown
# Quickstart

Install, validate, analyze, and serve in under a minute.

![Quickstart demo](../../assets/gifs/quickstart.gif)

## Prerequisites

- Rust toolchain installed (`rustup`)
- Terminal with UTF-8 support

## Steps

### Install skrills

Install via cargo with a single command.

```bash
cargo install skrills
```

### Validate Skills

Validate and auto-fix missing frontmatter.

```bash
skrills validate --target codex --autofix
```

### Analyze Token Usage

Analyze skills for token optimization opportunities.

```bash
skrills analyze --min-tokens 500 --suggestions
```

### Start MCP Server

Start the MCP server.

```bash
skrills serve
```

## Next Steps

- [Sync Workflow](./sync.md) - Bidirectional sync between Claude Code and Codex CLI
- [MCP Integration](./mcp.md) - Use skrills as an MCP server
```

## Technical Book Format

### Template Structure

```markdown
# {Tutorial Title}

{Extended description}

## Overview

{Context and learning objectives}

![Demo]({relative-path-to-gif})

## {Step 1 Name}

{@book-detail content - multiple paragraphs allowed}

```bash
{command from Type directive}
```

{Additional explanation of what the command does}

## {Step 2 Name}

{@book-detail content}

```bash
{command}
```

{Explanation of output and next steps}

## Summary

{Key takeaways}

## Further Reading

- Internal link 1
- External reference 1
```

### Example Output

```markdown
# Quickstart

This guide walks through the complete skrills workflow: installation, validation, analysis, and serving skills via MCP.

## Overview

By the end of this tutorial, you'll understand:
- How to install skrills using cargo
- The difference between Claude Code and Codex CLI validation targets
- How to analyze skills for token optimization
- How to expose skills via the MCP protocol

![Quickstart demo](../assets/gifs/quickstart.gif)

## Install skrills

The recommended installation method uses cargo, Rust's package manager. This validates you get the latest stable release with all dependencies properly resolved. For development builds or specific versions, you can also install from source.

```bash
cargo install skrills
```

The binary will be placed in `~/.cargo/bin/`, which should be in your PATH if you installed Rust using rustup.

## Validate Skills

Skrills validates skills against two targets with different strictness levels. Claude Code accepts any markdown file as a skill, while Codex CLI requires YAML frontmatter with specific fields.

```bash
skrills validate --target codex --autofix
```

The `--autofix` flag automatically derives missing frontmatter from the file path and content:
1. Parses the skill filename to derive `name`
2. Extracts the first paragraph as `description`
3. Inserts YAML frontmatter at the file start

This makes migration from Claude Code to Codex straightforward.

## Analyze Token Usage

The analyzer reports token counts for each skill and suggests optimizations for large skills that may consume excessive context.

```bash
skrills analyze --min-tokens 500 --suggestions
```

Skills exceeding the threshold are flagged with specific recommendations:
- Split into multiple focused skills
- Extract reusable modules
- Remove redundant content

## Start MCP Server

When running as an MCP server, skrills exposes tools for skill discovery, validation, and analysis to any MCP-compatible client.

```bash
skrills serve
```

The server listens on the default MCP port and responds to tool invocations from Claude Code or other clients.

## Summary

- Install skrills with `cargo install skrills`
- Validate skills for Codex compatibility with `--target codex`
- Use `--autofix` to automatically add required frontmatter
- Analyze token usage to optimize context consumption
- Serve skills via MCP for integration with AI assistants

## Further Reading

- [Sync Workflow](./sync.md) - Bidirectional synchronization between skill repositories
- [MCP Integration](./mcp.md) - Advanced MCP server configuration
- [Skill Debugging](./skill-debug.md) - Troubleshooting skill loading issues
```

## GIF Embedding

### Relative Path Calculation

GIFs are embedded with paths relative to the markdown file:

| Markdown Location | GIF Location | Relative Path |
|-------------------|--------------|---------------|
| `docs/tutorials/quickstart.md` | `assets/gifs/quickstart.gif` | `../../assets/gifs/quickstart.gif` |
| `book/src/tutorials/quickstart.md` | `assets/gifs/quickstart.gif` | `../../../assets/gifs/quickstart.gif` |
| `README.md` | `assets/gifs/quickstart.gif` | `assets/gifs/quickstart.gif` |

### Path Calculation Algorithm

```python
def relative_gif_path(markdown_path: str, gif_path: str) -> str:
    """Calculate relative path from markdown file to GIF."""
    from pathlib import Path

    md = Path(markdown_path)
    gif = Path(gif_path)

    # Get common ancestor
    common = Path(*os.path.commonprefix([md.parts, gif.parts]))

    # Calculate relative path
    md_depth = len(md.parent.relative_to(common).parts)
    gif_relative = gif.relative_to(common)

    return "../" * md_depth + str(gif_relative)
```

### Embedding Format

```markdown
![{Alt text}]({relative-path})
```

For multi-component tutorials with combined GIF:

```markdown
![{Tutorial title} demo]({relative-path-to-combined-gif})

*This demo shows both terminal and browser interactions.*
```

## README Integration

### Demo Section Template

```markdown
## Demos

### {Tutorial 1 Title}
![{Tutorial 1 title} demo]({gif-path})
*{Description}. [Full tutorial]({docs-tutorial-path})*

### {Tutorial 2 Title}
![{Tutorial 2 title} demo]({gif-path})
*{Description}. [Full tutorial]({docs-tutorial-path})*
```

### Generating README Section

```python
def generate_readme_demos(tutorials: list) -> str:
    """Generate demo section for README."""
    lines = ["## Demos", ""]

    for tutorial in tutorials:
        lines.extend([
            f"### {tutorial['title']}",
            f"![{tutorial['title']} demo]({tutorial['gif_path']})",
            f"*{tutorial['description']}. [Full tutorial]({tutorial['docs_path']})*",
            ""
        ])

    return "\n".join(lines)
```

### Updating README

Replace the existing demo section or append if not present:

```bash
# Check if demo section exists
if grep -q "^## Demos" README.md; then
  # Replace section (between ## Demos and next ##)
  sed -i '/^## Demos/,/^## [^D]/{ /^## [^D]/!d }' README.md
  # Insert new content after ## Demos
fi
```

## Book SUMMARY.md Integration

### Template

```markdown
- [Tutorials](./tutorials/README.md)
  - [{Tutorial 1 Title}](./tutorials/{name1}.md)
  - [{Tutorial 2 Title}](./tutorials/{name2}.md)
```

### Detection and Update

```bash
# Check if tutorials section exists in SUMMARY.md
if [[ -f "book/src/SUMMARY.md" ]]; then
  if grep -q "Tutorials" book/src/SUMMARY.md; then
    echo "Tutorials section exists - update entries"
  else
    echo "Add Tutorials section to SUMMARY.md"
  fi
fi
```

## Content Guidelines

### Project Docs Style

- Action-oriented imperatives: "Install", "Run", "Configure"
- One paragraph per step maximum
- Focus on commands and results
- Minimal explanation of "why"
- Include prerequisites section

### Technical Book Style

- Educational tone: "This guide explains..."
- Multiple paragraphs allowed per step
- Explain rationale and context
- Include troubleshooting tips
- Reference related concepts
- Add summary and further reading sections

### Common Rules (Both)

- No filler phrases ("simply", "just", "easily")
- No emojis or decorative elements
- Grounded, specific language
- Code blocks for all commands
- Consistent heading hierarchy
- Prose text wraps at 80 chars per line (hybrid wrapping:
  prefer sentence/clause boundaries over arbitrary breaks)
- Blank line before and after every heading
- ATX headings only (`#` prefix, no setext underlines)
- Blank line before every list
- Reference-style links when inline links push past 80 chars
- Full formatting spec: `Skill(leyline:markdown-formatting)`

## Error Handling

| Issue | Resolution |
|-------|------------|
| Missing @docs-brief | Fall back to @book-detail or step name |
| Missing @book-detail | Fall back to @docs-brief or generate minimal text |
| No Output directive | Skip GIF embed, log warning |
| Invalid path calculation | Verify markdown and GIF paths are relative to project root |
| README section conflict | Preserve user content outside ## Demos section |
