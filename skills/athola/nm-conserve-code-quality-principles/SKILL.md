---
name: code-quality-principles
description: |
  KISS, YAGNI, and SOLID code quality principles for clean code, reducing complexity and preventing over-engineering
version: 1.8.1
triggers:
  - design
  - principles
  - clean-code
  - architecture
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/conserve", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: conserve
---

> **Night Market Skill** — ported from [claude-night-market/conserve](https://github.com/athola/claude-night-market/tree/master/plugins/conserve). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [KISS (Keep It Simple, Stupid)](#kiss-keep-it-simple-stupid)
- [YAGNI (You Aren't Gonna Need It)](#yagni-you-arent-gonna-need-it)
- [SOLID Principles](#solid-principles)
- [Quick Reference](#quick-reference)
- [When Principles Conflict](#when-principles-conflict)
- [Integration with Code Review](#integration-with-code-review)

# Code Quality Principles

Guidance on KISS, YAGNI, and SOLID principles with language-specific examples.


## When To Use

- Improving code readability and maintainability
- Applying SOLID, KISS, YAGNI principles during refactoring

## When NOT To Use

- Throwaway scripts or one-time data migrations
- Performance-critical code where readability trades are justified

## KISS (Keep It Simple, Stupid)

**Principle**: Avoid unnecessary complexity. Prefer obvious solutions over clever ones.

### Guidelines

| Prefer | Avoid |
|--------|-------|
| Simple conditionals | Complex regex for simple checks |
| Explicit code | Magic numbers/strings |
| Standard patterns | Clever shortcuts |
| Direct solutions | Over-abstracted layers |

### Python Example

```python
# Bad: Overly clever one-liner
users = [u for u in (db.get(id) for id in ids) if u and u.active and not u.banned]

# Good: Clear and readable
users = []
for user_id in ids:
    user = db.get(user_id)
    if user and user.active and not user.banned:
        users.append(user)
```

### Rust Example

```rust
// Bad: Unnecessary complexity
fn process(data: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    data.iter()
        .map(|&b| b.checked_add(1).ok_or("overflow"))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.into())
}

// Good: Simple and clear
fn process(data: &[u8]) -> Result<Vec<u8>, &'static str> {
    let mut result = Vec::with_capacity(data.len());
    for &byte in data {
        result.push(byte.checked_add(1).ok_or("overflow")?);
    }
    Ok(result)
}
```

## YAGNI (You Aren't Gonna Need It)

**Principle**: Don't implement features until they are actually needed.

### Guidelines

| Do | Don't |
|----|-------|
| Solve current problem | Build for hypothetical futures |
| Add when 3rd use case appears | Create abstractions for 1 use case |
| Delete dead code | Keep "just in case" code |
| Minimal viable solution | Premature optimization |

### Python Example

```python
# Bad: Premature abstraction for one use case
class AbstractDataProcessor:
    def process(self, data): ...
    def validate(self, data): ...
    def transform(self, data): ...

class CSVProcessor(AbstractDataProcessor):
    def process(self, data):
        return self.transform(self.validate(data))

# Good: Simple function until more cases appear
def process_csv(data: list[str]) -> list[dict]:
    return [parse_row(row) for row in data if row.strip()]
```

### TypeScript Example

```typescript
// Bad: Over-engineered config system
interface ConfigProvider<T> {
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
  watch<K extends keyof T>(key: K, callback: (v: T[K]) => void): void;
}

// Good: Simple config for current needs
const config = {
  apiUrl: process.env.API_URL || 'http://localhost:3000',
  timeout: 5000,
};
```

## SOLID Principles

### Single Responsibility Principle

Each module/class should have one reason to change.

```python
# Bad: Multiple responsibilities
class UserManager:
    def create_user(self, data): ...
    def send_welcome_email(self, user): ...  # Email responsibility
    def generate_report(self, users): ...     # Reporting responsibility

# Good: Separated responsibilities
class UserRepository:
    def create(self, data): ...

class EmailService:
    def send_welcome(self, user): ...

class UserReportGenerator:
    def generate(self, users): ...
```

### Open/Closed Principle

Open for extension, closed for modification.

```python
# Bad: Requires modification for new types
def calculate_area(shape):
    if shape.type == "circle":
        return 3.14 * shape.radius ** 2
    elif shape.type == "rectangle":
        return shape.width * shape.height
    # Must modify to add new shapes

# Good: Extensible without modification
from abc import ABC, abstractmethod

class Shape(ABC):
    @abstractmethod
    def area(self) -> float: ...

class Circle(Shape):
    def __init__(self, radius: float):
        self.radius = radius
    def area(self) -> float:
        return 3.14 * self.radius ** 2
```

### Liskov Substitution Principle

Subtypes must be substitutable for their base types.

```python
# Bad: Violates LSP - Square changes Rectangle behavior
class Rectangle:
    def set_width(self, w): self.width = w
    def set_height(self, h): self.height = h

class Square(Rectangle):  # Breaks when used as Rectangle
    def set_width(self, w):
        self.width = self.height = w  # Unexpected side effect

# Good: Separate types with common interface
class Shape(ABC):
    @abstractmethod
    def area(self) -> float: ...

class Rectangle(Shape):
    def __init__(self, width: float, height: float): ...

class Square(Shape):
    def __init__(self, side: float): ...
```

### Interface Segregation Principle

Clients shouldn't depend on interfaces they don't use.

```typescript
// Bad: Fat interface
interface Worker {
  work(): void;
  eat(): void;
  sleep(): void;
}

// Good: Segregated interfaces
interface Workable {
  work(): void;
}

interface Feedable {
  eat(): void;
}

// Clients only implement what they need
class Robot implements Workable {
  work(): void { /* ... */ }
}
```

### Dependency Inversion Principle

Depend on abstractions, not concretions.

```python
# Bad: Direct dependency on concrete class
class OrderService:
    def __init__(self):
        self.db = PostgresDatabase()  # Tight coupling

# Good: Depend on abstraction
from abc import ABC, abstractmethod

class Database(ABC):
    @abstractmethod
    def save(self, data): ...

class OrderService:
    def __init__(self, db: Database):
        self.db = db  # Injected abstraction
```

## Quick Reference

| Principle | Question to Ask | Red Flag |
|-----------|-----------------|----------|
| KISS | "Is there a simpler way?" | Complex solution for simple problem |
| YAGNI | "Do I need this right now?" | Building for hypothetical use cases |
| SRP | "What's the one reason to change?" | Class doing multiple jobs |
| OCP | "Can I extend without modifying?" | Switch statements for types |
| LSP | "Can subtypes replace base types?" | Overridden methods with side effects |
| ISP | "Does client need all methods?" | Empty method implementations |
| DIP | "Am I depending on abstractions?" | `new` keyword in business logic |

## When Principles Conflict

1. **KISS vs SOLID**: For small projects, KISS wins. Add SOLID patterns as complexity grows.
2. **YAGNI vs DIP**: Don't add abstractions until you have 2+ implementations.
3. **Readability vs DRY**: Prefer slight duplication over wrong abstraction.

## Integration with Code Review

When reviewing code, check:
- [ ] No unnecessary complexity (KISS)
- [ ] No speculative features (YAGNI)
- [ ] Each class has single responsibility (SRP)
- [ ] No god classes (> 500 lines)
- [ ] Dependencies are injected, not created (DIP)

**Verification:** Run `wc -l <file>` to check line counts and `rg -c "class " <file>` (or `grep -c "class " <file>`) to count classes per file.
