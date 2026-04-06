# Organization Patterns

## Directory Structure

### Recommended Layout
```
.claude/rules/
  api-validation.md       # Descriptive names
  testing-standards.md    # Topic-based naming
  frontend/               # Subdirectories for grouping
    react-patterns.md
    css-conventions.md
```

### Anti-Patterns
```
.claude/rules/
  rules1.md              # Non-descriptive names
  misc.md                # Catch-all files
  RULES.md               # Shouting case
  my rules file.md       # Spaces in filenames
```

## Naming Conventions

- Use kebab-case: `api-validation.md`
- Be descriptive: name should indicate rule content
- Use subdirectories for 5+ rule files
- Avoid generic names: `rules.md`, `misc.md`, `todo.md`

## Symlink Support

Symlinks enable shared rules across projects:
```bash
ln -s ~/shared-rules/code-style.md .claude/rules/code-style.md
```

Validate that symlink targets exist and are readable.

## Scoring (15 points)

| Check | Points | Criteria |
|-------|--------|----------|
| Descriptive filenames | 5 | Names indicate content |
| Kebab-case naming | 4 | Consistent formatting |
| Logical grouping | 3 | Subdirectories when needed |
| No broken symlinks | 3 | All symlinks resolve |
