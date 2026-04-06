# Language Audit Patterns

Detailed patterns and commands for detecting project languages and their documentation implications.

## Manifest File Detection

Check for language-specific manifest files to identify the primary language(s):

```bash
# Rust
ls -1 Cargo.toml 2>/dev/null

# Node.js/TypeScript
ls -1 package.json 2>/dev/null

# Go
ls -1 go.mod 2>/dev/null

# Python
ls -1 pyproject.toml setup.py requirements.txt 2>/dev/null

# Java/Kotlin
ls -1 pom.xml build.gradle build.gradle.kts 2>/dev/null

# Ruby
ls -1 Gemfile 2>/dev/null

# PHP
ls -1 composer.json 2>/dev/null
```

## File Count Analysis

Count source files by extension to determine language distribution:

```bash
# Rust
git ls-files | rg '\.rs$' | wc -l
# or for preview
rg --files -g '*.rs' | head -10

# Python
git ls-files | rg '\.py$' | wc -l
rg --files -g '*.py' | head -10

# Go
git ls-files | rg '\.go$' | wc -l
rg --files -g '*.go' | head -10

# TypeScript/JavaScript
git ls-files | rg '\.(ts|tsx|js|jsx)$' | wc -l
rg --files -g '*.ts' -g '*.tsx' | head -10

# Java
git ls-files | rg '\.java$' | wc -l
rg --files -g '*.java' | head -10
```

## Language Priority Heuristics

Determine primary language using these priority rules:

1. **Manifest presence**: If a language-specific manifest exists, it's a strong signal
2. **File count dominance**: Language with >60% of source files is primary
3. **Directory structure**: Check for language-specific directories (src/, lib/, pkg/)
4. **Build configuration**: Presence of Makefile, CMakeLists.txt, or build scripts

## Secondary Language Handling

Document secondary languages when they:

- Represent >20% of codebase
- Serve distinct architectural roles (e.g., Rust backend + TypeScript frontend)
- Have their own build/test infrastructure
- Require separate installation or runtime considerations

### Example Multi-Language Documentation Strategy

```markdown
## Installation

### Backend (Rust)
[Rust-specific instructions]

### Frontend (TypeScript)
[Node/npm-specific instructions]
```

## Recording Findings

Capture the audit results in a structured format:

```
Language Audit Results:
- Primary: [Language] ([count] files, [manifest])
- Secondary: [Language] ([count] files, [manifest])
- Method: [manifest detection | file count | directory structure]
- Documentation implications: [single-language | multi-language sections needed]
```
