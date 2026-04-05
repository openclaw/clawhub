---
name: sql-injection
description: Detection of format! macros that interpolate user-controlled
  values directly into SQL keyword strings without parameterized queries
category: rust-review
tags: [security, sql, injection, format]
---

# SQL Injection

Detection of `format!` calls that build SQL strings with `{}` interpolation,
bypassing parameterized query protection.

## What This Detects

`format!` strings containing SQL keywords (`SELECT`, `INSERT`, `UPDATE`,
`DELETE`, `DROP`, `WHERE`) combined with `{}` placeholders, which interpolate
values at the Rust string level rather than through the database driver's
parameter binding.

## Why It Matters

String interpolation into SQL is the classic SQL injection vector.
Database drivers (sqlx, diesel, rusqlite) all provide parameterized query
APIs that eliminate the risk at zero cost.

## Safe Patterns

```rust
// Good: sqlx parameterized query
sqlx::query("SELECT * FROM users WHERE id = $1")
    .bind(user_id)
    .fetch_one(&pool)
    .await?;
```

## Patterns to Flag

```rust
// Bad: format! with SQL keyword and {} interpolation
let query = format!("SELECT * FROM users WHERE name = '{}'", name);

// Bad: value injected before keyword
let q = format!("DELETE FROM {} WHERE id = 1", table_name);
```

## Output Section

```markdown
## SQL Injection
### Issues Found
- [file:line] format! SQL interpolation: [explanation]

### Recommendations
- Replace format! SQL strings with parameterized queries
- Use sqlx::query!(...).bind(...) or equivalent
```
