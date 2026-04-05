---
parent_skill: pensive:bug-review
category: detection
estimated_tokens: 250
progressive_loading: true
---

# Language Detection and Expertise Framing

Identify project languages and establish appropriate expertise context.

## Manifest Heuristics

Use manifest files to detect primary languages:

| Manifest | Language | Ecosystem |
|----------|----------|-----------|
| `Cargo.toml` | Rust | cargo |
| `package.json` | JavaScript/TypeScript | npm/yarn/pnpm |
| `go.mod` | Go | go modules |
| `pyproject.toml`, `setup.py` | Python | pip/poetry/uv |
| `pom.xml`, `build.gradle` | Java | maven/gradle |
| `*.csproj` | C# | dotnet |

## Version Constraints

Extract and note version requirements:

**Rust**: Check MSRV (Minimum Supported Rust Version)
```toml
[package]
rust-version = "1.70.0"
```

**Python**: Check required version
```toml
[project]
requires-python = ">=3.8"
```

**Node**: Check engine constraints
```json
"engines": {
  "node": ">=18.0.0"
}
```

**Go**: Check minimum version
```go
go 1.21
```

## Expertise Persona

Frame appropriate expertise based on detected languages:

**Rust**: "Staff engineer specializing in Rust systems programming with expertise in ownership, lifetimes, and async runtimes"

**Python**: "Senior Python developer with expertise in type systems, async patterns, and performance optimization"

**Go**: "Go engineer with deep understanding of concurrency, channels, and idiomatic error handling"

**TypeScript**: "TypeScript expert focused on type safety, React patterns, and async workflows"

State this persona explicitly to establish review context and credibility.
