# Glob Pattern Analysis

## Pattern Quality Assessment

### Good Patterns
```
"src/api/**/*.ts"       # Specific scope
"tests/**/*.test.ts"    # Clear intent
"{src,lib}/**/*.ts"     # Multiple dirs, quoted
"*.config.{js,ts}"      # Config files only
```

### Problem Patterns
```
"**/*"                  # Too broad - matches everything
"*"                     # Root only, usually too narrow
**/*.ts                 # Unquoted - YAML parse error
"."                     # Invalid glob
```

## Validation Rules

1. **Syntax validity**: Pattern must be valid glob syntax
2. **Quoting**: Patterns with `*`, `{`, `}`, `[`, `]` must be quoted
3. **Specificity**: Patterns should not match everything (`**/*`)
4. **Intent clarity**: Pattern should clearly indicate target files

## Scoring (20 points, deductive)

Starts at 20, deducts for issues found. Files without `paths` receive full score.

| Issue | Deduction | Criteria |
|-------|-----------|----------|
| Overly broad pattern | -5 each | Matches `**/*`, `*`, etc. |
| Empty pattern | -4 each | Blank or whitespace-only pattern |
