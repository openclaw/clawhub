---
parent_skill: pensive:api-review
name: surface-inventory
description: Detect and catalog API surfaces across languages
category: api-analysis
tags: [api, inventory, surface, detection]
---

# Surface Inventory

Catalog all public API surfaces, stability promises, and versioning metadata.

## Detection by Language

### Rust
```bash
# Public functions and types
rg -n "^pub" src

# Generate documentation
cargo doc --no-deps

# Check feature flags
rg -n "^#\[cfg\(feature" src
```

### Python
```bash
# Public functions
rg -n "^def [^_]" package

# Exported items
rg -n "^__all__" package

# Sphinx documentation
sphinx-build -b html docs docs/_build
```

### Go
```bash
# List packages
go list ./...

# Public functions
rg -n "^func [A-Z]"

# Generate docs
go doc -all
```

### TypeScript
```bash
# Show configuration
tsc --showConfig

# Exported items
rg -n "^export" src

# Generate documentation
npx typedoc
```

### HTTP/REST APIs
```bash
# Framework endpoints
rg -n "@app\.(get|post|put|delete)"

# OpenAPI spec
grep -n "path:" openapi.yaml
yq eval '.paths' openapi.yaml
```

## Stability Metadata

### Capture for Each API
- **Stability level**: stable, beta, alpha, experimental
- **Version introduced**: semver or date
- **Deprecation status**: deprecated, planned, stable
- **Feature flags**: compile-time, runtime, experimental

### Commands by Language
```bash
# Rust: Stability attributes
rg -n "#\[(stable|unstable|deprecated)" src

# Python: Version metadata
rg -n "__version__|version_info" package

# Go: Build tags
rg -n "^// \+build" .

# OpenAPI: Version field
yq eval '.info.version' openapi.yaml
```

## Output Structure

Record in evidence log:
```markdown
## Surface Inventory

### Language: [Rust/Python/Go/etc]
- Public functions: N
- Public types: N
- Feature flags: N
- Stability: [table]

### Endpoints (HTTP)
- GET endpoints: N
- POST endpoints: N
- Version: v1, v2

### Stability Distribution
- Stable: N
- Beta: N
- Experimental: N
```

## Versioning Patterns

### SemVer (Rust, Node.js)
```bash
grep "^version" Cargo.toml
grep "\"version\"" package.json
```

### CalVer (APIs)
```bash
yq eval '.info.version' openapi.yaml
```

### Feature Versioning
```bash
# API version headers
rg -n "api-version|API-Version" src
```
