---
name: tech-stack-patterns
description: Technology-specific patterns for common stacks, tools, and ignore file configurations
category: patterns
tags: [patterns, tech-stack, configuration, ignore-files]
dependencies: [task-planning]
complexity: beginner
estimated_tokens: 600
---

# Technology Stack Patterns

## Overview

Common patterns for ignore files, tool configurations, and technology-specific artifacts across different development stacks.

## Universal Ignore Patterns

Patterns that apply to all projects regardless of stack:

```
# OS artifacts
.DS_Store
Thumbs.db
desktop.ini

# IDE/Editor
.vscode/
.idea/
*.swp
*.swo
*~
.project
.classpath
.settings/

# Logs
*.log
logs/
```

## Language-Specific Patterns

### Node.js / JavaScript / TypeScript

```
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Build outputs
dist/
build/
out/
.next/
.nuxt/

# Cache
.npm
.eslintcache
.cache/
.parcel-cache/

# Environment
.env
.env.local
.env.*.local
```

### Python

```
# Virtual environments
venv/
env/
.venv/
ENV/
.Python

# Build outputs
__pycache__/
*.py[cod]
*$py.class
*.so
.eggs/
*.egg-info/
dist/
build/

# Testing
.pytest_cache/
.coverage
htmlcov/
.tox/
```

### Rust

```
# Build outputs
target/
Cargo.lock  # (exclude for libraries, include for binaries)

# Debug symbols
*.pdb
```

### Go

```
# Build outputs
*.exe
*.exe~
*.dll
*.so
*.dylib
*.test

# Binary
bin/
vendor/
```

### Java / Kotlin

```
# Build outputs
*.class
*.jar
*.war
*.ear
target/
build/
out/

# IDE
.gradle/
.mvn/
```

### C# / .NET

```
# Build outputs
bin/
obj/
*.dll
*.exe
*.pdb

# User-specific
*.user
*.suo
*.userprefs
```

## Common Tool Configurations

### Docker

```
# Docker
.dockerignore
docker-compose.override.yml
```

### Git

```
# Git
.git/
.gitattributes
```

### Terraform

```
# Terraform
*.tfstate
*.tfstate.*
.terraform/
.terraform.lock.hcl
```

### Linting & Formatting

```
# ESLint
.eslintcache

# Prettier
.prettierignore

# Ruff (Python)
.ruff_cache/
```

## Cloud Provider Artifacts

```
# AWS
.aws/
*.pem

# GCP
.gcloud/
*-key.json

# Azure
.azure/
```

## Usage in Spec-Kit

When generating .gitignore recommendations in planning phase:
1. Start with universal patterns
2. Add language-specific patterns based on tech stack
3. Include tool-specific patterns from implementation plan
4. Add cloud provider patterns if applicable
