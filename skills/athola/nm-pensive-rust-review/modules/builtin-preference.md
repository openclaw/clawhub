---
name: builtin-preference
description: Detection of helper functions that should be standard trait
  implementations and reimplemented Rust builtins
category: rust-review
tags: [from, into, tryfrom, fromstr, default, display, iterator, idioms]
---

# Builtin Preference

Detects custom helper functions that duplicate Rust's standard
trait system and built-in combinators.

## What This Detects

Four categories of anti-patterns:

1. **Conversion helpers**: `parse_foo()`, `foo_from_bar()`,
   `convert_*()`, `to_*(&self)` that should be `FromStr`,
   `From`, `TryFrom`, or `Into` implementations
2. **Standard trait replacements**: `default_config()`,
   `format_error()`, `as_bytes(&self)`, `compare()` that
   should be `Default`, `Display`, `AsRef`, or `PartialEq`
3. **Error conversion wrappers**: `io_to_my_error()`,
   `wrap_error()` that should be `impl From<Error>` or
   thiserror `#[from]`
4. **Manual combinators**: `match opt { Some(x) => Some(f(x)),
   None => None }` that should be `.map()`, `.unwrap_or()`,
   `.flatten()`, etc.

## Why It Matters

Rust's trait system is compositional by design:

- `impl From<A> for B` gives `impl Into<B> for A` for free
- `impl Display` gives `ToString` for free
- `From` enables the `?` operator for error propagation
- Trait impls participate in generic bounds and blanket impls
- Standard combinators are optimized and well-tested

Helper functions that bypass this system create API
inconsistency, miss ergonomic benefits, and signal
unfamiliarity with idiomatic Rust.

## Safe Patterns

```rust
// Good: From trait enables .into() and ? operator
impl From<Config> for Settings {
    fn from(c: Config) -> Self {
        Settings { timeout: c.timeout }
    }
}

// Good: FromStr enables .parse()
impl FromStr for Config {
    type Err = ConfigError;
    fn from_str(s: &str) -> Result<Self, Self::Err> { ... }
}

// Good: Default via derive
#[derive(Default)]
struct Config { timeout: u64 }

// Good: Display for human-readable output
impl fmt::Display for MyError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "Error: {}", self.msg)
    }
}

// Good: Option combinators
let result = opt.map(|x| x.to_string());
let value = opt.unwrap_or(default);
```

## Patterns to Flag

```rust
// Flag: should be impl FromStr
fn parse_config(s: &str) -> Config { ... }

// Flag: should be impl From<Bar> for Foo
fn foo_from_bar(b: Bar) -> Foo { ... }

// Flag: should be impl Default
fn default_config() -> Config { ... }

// Flag: should be impl From<io::Error> for MyError
fn io_to_my_error(e: io::Error) -> MyError { ... }

// Flag: should use .map()
match opt {
    Some(x) => Some(x.to_string()),
    None => None,
}
```

## Exclusions (Not Flagged)

- Lossy conversions (`to_lossy_ascii`)
- Builder methods (`with_timeout(self, ...)`)
- Multi-parameter conversions (context-dependent)
- Domain-specific operations (`serialize`, `encode`, `decode`)

## Related Clippy Lints

| Lint | Detects |
|------|---------|
| `clippy::from_over_into` | `impl Into` where `impl From` suffices |
| `clippy::manual_map` | Match on Option rewriting `.map()` |
| `clippy::manual_unwrap_or` | Match rewriting `.unwrap_or()` |
| `clippy::derivable_impls` | Manual Default that derive handles |
| `clippy::manual_flatten` | Nested iteration rewriting `.flatten()` |
| `clippy::new_without_default` | `fn new()` without `impl Default` |

## Output Section

```markdown
## Builtin Preference
### Issues Found
- [file:line] Conversion helper `parse_config`: use `impl FromStr`
- [file:line] Manual combinator: use `.map()` (clippy::manual_map)

### Recommendations
- Implement standard traits to gain ecosystem composability
- Enable relevant clippy lints for automated enforcement
```
