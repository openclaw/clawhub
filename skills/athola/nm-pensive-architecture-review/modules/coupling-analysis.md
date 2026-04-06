---
name: coupling-analysis
description: Interaction mapping, composition boundaries, and dependency flow analysis
parent_skill: pensive:architecture-review
category: architecture
tags: [coupling, dependencies, composition, boundaries, modularity]
complexity: advanced
estimated_tokens: 450
---

# Coupling Analysis Module

Systematic analysis of module interactions, boundaries, and dependency flows.

## Interaction Mapping Patterns

### Visual Representation

Create before/after diagrams:

```
Before:
┌─────────┐     ┌─────────┐     ┌──────────┐
│Module A │────▶│Module B │────▶│ Database │
└─────────┘     └─────────┘     └──────────┘

After:
┌─────────┐     ┌───────┐     ┌─────────┐     ┌──────────┐
│Module A │────▶│ Cache │────▶│Module B │────▶│ Database │
└─────────┘     └───────┘     └─────────┘     └──────────┘
```

### Dependency Graph Tools

```bash
# Python: Generate import graph
pydeps --max-bacon=2 --cluster src/

# TypeScript: Analyze module dependencies
madge --circular --extensions ts src/

# Generic: Find direct dependencies
grep -r "import\|require\|from" src/ | cut -d: -f1 | sort | uniq -c
```

## Composition Boundaries

### Boundary Definition

Clear boundaries have:
1. **Explicit interfaces** - Published contracts
2. **Data ownership** - Single source of truth
3. **Encapsulation** - Hidden implementation
4. **Stability** - Minimal breaking changes

### Boundary Types

**Module Boundaries:**
```
┌──────────────────────────┐
│   Public API             │
├──────────────────────────┤
│   Internal Logic         │
│   (implementation)       │
└──────────────────────────┘
```

**Layer Boundaries:**
```
┌──────────────────────────┐
│   Presentation Layer     │ ← HTTP/UI
├──────────────────────────┤
│   Application Layer      │ ← Business Logic
├──────────────────────────┤
│   Domain Layer           │ ← Core Models
├──────────────────────────┤
│   Infrastructure Layer   │ ← Database/External
└──────────────────────────┘
```

**Service Boundaries:**
```
Service A          Service B
┌────────┐        ┌────────┐
│  API   │◀──────▶│  API   │
├────────┤        ├────────┤
│  DB A  │        │  DB B  │
└────────┘        └────────┘
```

### Boundary Violations

**Ad-hoc Reach-ins:**
```python
# Bad: Reaching through module boundary
user.profile.settings.theme.get_color()

# Good: Ask for what you need
user.get_theme_color()
```

**Layering Violations:**
```python
# Bad: Domain layer accessing infrastructure
class Order:
    def save(self):
        db.execute("INSERT INTO orders...")

# Good: Infrastructure handles persistence
class OrderRepository:
    def save(self, order: Order):
        db.execute("INSERT INTO orders...")
```

## Data Ownership Analysis

### Single Owner Principle

Each data entity has exactly one authoritative owner:

```
User Data:
├── Auth Service (owner: credentials)
├── Profile Service (owner: profile data)
└── Analytics Service (consumer: read-only)
```

### Ownership Violations

**Multiple Writers:**
```python
# Bad: Two services modify same data
auth_service.update_user_email()
profile_service.update_user_email()

# Good: Single owner
profile_service.update_email()  # Publishes event
auth_service.handle_email_changed()  # Subscribes to event
```

**Ownership Leaks:**
```python
# Bad: Exposing internal structure
def get_user():
    return user_database_model

# Good: Return boundary type
def get_user():
    return UserDTO(id=..., name=...)
```

## Dependency Flow Checking

### Expected Flow Patterns

**Layered Architecture:**
```
Presentation → Application → Domain → Infrastructure
     ↓              ↓           ↓            ↓
  (no reverse dependencies allowed)
```

**Hexagonal Architecture:**
```
     ┌─────────────┐
     │   Domain    │ ← Core (no dependencies)
     └──────┬──────┘
            │
  ┌─────────┴─────────┐
  │   Application     │ ← Orchestration
  └────────┬──────────┘
           │
  ┌────────┴─────────┐
  │   Adapters       │ ← External interfaces
  └──────────────────┘
```

### Circular Dependency Detection

```bash
# Python
pydeps --show-cycles src/

# JavaScript/TypeScript
madge --circular src/

# Manual check
grep -r "from.*import" src/ | # Extract all imports
  python -c "
import sys
from collections import defaultdict

graph = defaultdict(set)
for line in sys.stdin:
    # Parse: file imports module
    # Build graph, detect cycles
"
```

### Dependency Metrics

**Afferent Coupling (Ca):**
Number of modules that depend on this module.
- High Ca = Stable (many dependents)

**Efferent Coupling (Ce):**
Number of modules this module depends on.
- High Ce = Unstable (many dependencies)

**Instability (I):**
```
I = Ce / (Ca + Ce)
```
- I = 0: Maximally stable
- I = 1: Maximally unstable

### Ideal Patterns

**Stable Abstractions:**
- Core domain: Low I (stable)
- Infrastructure: High I (unstable, replaceable)

**Dependency Direction:**
```
Unstable → Stable
(changing) depends on (stable)
```

## Side Effects Analysis

### Side Effect Categories

**1. State Mutations:**
```python
# Track mutations
def process_order(order):
    order.status = "PROCESSED"  # Mutation
    notify_customer(order)       # Side effect
    log_event(order)            # Side effect
```

**2. External I/O:**
- Database writes
- API calls
- File operations
- Message queue publishing

**3. Timing Dependencies:**
- Caching
- Rate limiting
- Session management

### Containment Strategies

**Command-Query Separation:**
```python
# Query: No side effects
def get_order_total(order): -> Decimal

# Command: Mutations allowed
def place_order(order) -> None
```

**Effect Tracking:**
```python
# Explicit effect types
Effect = Database | API | Cache | Event

def process_payment(order) -> tuple[Result, list[Effect]]:
    effects = []
    # Track all effects
    return result, effects
```

## Cross-Boundary Dependencies

### Allowed Patterns

**1. Events:**
```python
# Service A publishes
event_bus.publish(UserCreated(user_id))

# Service B subscribes
@subscribe(UserCreated)
def handle_user_created(event):
    # React independently
```

**2. Shared Kernel:**
```python
# Common domain types
from shared.types import Money, UserId, Email
```

**3. Published APIs:**
```python
# Service B calls Service A's API
response = service_a_client.get_user(user_id)
```

### Forbidden Patterns

**1. Shared Database:**
```python
# Bad: Direct database access across services
user_db.query("SELECT * FROM users")  # From order service
```

**2. Implementation Sharing:**
```python
# Bad: Importing internal modules
from service_a.internal.helpers import format_date
```

## Integration with Architecture Review

Use this module during Step 3 (Interaction Mapping):
1. Map all module interactions (before/after)
2. Verify composition boundaries
3. Check data ownership clarity
4. Validate dependency flow direction
5. Detect circular dependencies
6. Identify coupling violations
7. Analyze side effect containment
