---
name: principle-checks
description: Law of Demeter, anti-slop patterns, AI guardrails, and security/performance checks
parent_skill: pensive:architecture-review
category: architecture
tags: [principles, demeter, anti-patterns, security, performance, quality]
complexity: advanced
estimated_tokens: 500
---

# Principle Checks Module

Systematic verification of architectural principles, anti-patterns, and quality attributes.

## Law of Demeter (LoD)

### The Principle

"Talk to friends, not to strangers."

An object should only call methods on:
1. Itself
2. Its parameters
3. Objects it creates
4. Its direct components

### Train Wreck Detection

**Anti-pattern:**
```python
# Bad: Chain of calls
customer.get_address().get_city().get_postal_code()

# Bad: Multiple dereferences
order.customer.billing_address.street

# Bad: Deep navigation
context.request.session.user.preferences.theme
```

**Search patterns:**
```bash
# Python
grep -rn '\.\w\+(\)\.\w\+(\)\.\w\+(' src/

# JavaScript/TypeScript
grep -rn '\.\w\+\.\w\+\.\w\+' src/ --include="*.js" --include="*.ts"

# Count violations
grep -r '\.\w\+\.\w\+\.\w\+' src/ | wc -l
```

### Refactoring Strategies

**Strategy 1: Tell, Don't Ask**
```python
# Before
if customer.get_address().get_country() == "US":
    apply_us_tax()

# After
if customer.is_in_country("US"):
    apply_us_tax()
```

**Strategy 2: Move Logic to Owner**
```python
# Before
postal_code = customer.get_address().get_postal_code()
region = lookup_region(postal_code)

# After
region = customer.get_region()  # Address logic inside Customer
```

**Strategy 3: Introduce Facade**
```python
# Before
config.get_database().get_connection_pool().get_connection()

# After
config.get_database_connection()  # Facade hides complexity
```

## Anti-Slop Checks

### What is "Slop"?

Code that appears professional but lacks substance:
- Generic naming
- Overengineering
- Cargo cult patterns
- Hallucinated dependencies
- Hollow abstractions

### Detection Patterns

**1. Overengineering Red Flags:**
```python
# Bad: Unnecessary abstraction layers
class UserFactoryFactory:
    def create_user_factory(self):
        return UserFactory()

# Bad: Premature generalization
class AbstractBaseEntityManagerInterface:
    pass
```

**Search:**
```bash
# Find "Abstract" overuse
grep -r "class Abstract" src/ | wc -l

# Find "Manager" bloat
grep -r "Manager\|Handler\|Processor" src/ --include="*.py"

# Find deep inheritance
grep -A 5 "class.*:" src/**/*.py | grep "    class"
```

**2. Generic Naming:**
```python
# Bad: Non-descriptive names
def process_data(data):
    result = handle_item(data)
    return do_thing(result)

# Good: Specific names
def calculate_tax(order):
    taxable_amount = extract_taxable_items(order)
    return apply_tax_rate(taxable_amount)
```

**Search:**
```bash
# Find generic names
grep -rn "process\|handle\|manage\|do_\|data\|item\|thing" src/
```

**3. Hidden Fragility:**
```python
# Bad: Silent failure
try:
    critical_operation()
except Exception:
    pass  # Swallowed error

# Bad: Implicit coupling
global_state = {}  # Hidden dependency

# Bad: Magic values
if status == 42:  # What does 42 mean?
```

**Search:**
```bash
# Find bare except
grep -rn "except:" src/

# Find global state
grep -rn "^[A-Z_]\+ = " src/

# Find magic numbers
grep -rn "if.*== [0-9]\+" src/
```

**4. Hallucinated Dependencies:**
```python
# Bad: Assuming non-existent methods
user.auto_validate()  # Does this exist?
cache.smart_invalidate()  # What does "smart" mean?

# Bad: Imaginary patterns
@auto_retry  # Not in codebase
@cache_result  # Decorator doesn't exist
```

**Verification:**
```bash
# Check decorator existence
grep -r "^def auto_retry\|^class auto_retry" src/

# Verify method definitions
grep -r "def auto_validate" src/
```

## Guardrails for AI Assistance

### Evidence-Based Critiques

**Required:**
- File paths
- Line numbers
- Actual code snippets
- Measured metrics

**Forbidden:**
- "Looks like..."
- "Probably should..."
- "Best practice is..."
- "Generally we..."

### Trade-Off Statements

**Good:**
```
Option A: PostgreSQL
+ Proven reliability, ACID compliance
+ Team expertise
- Higher hosting cost
- Vertical scaling limits

Option B: DynamoDB
+ Horizontal scalability
+ Lower latency
- Team learning curve
- Complex query limitations
```

**Bad:**
```
"PostgreSQL is better for this use case."
"DynamoDB would be more scalable."
```

### Replace Hollow Phrases

| Hollow Phrase | Replace With |
|--------------|--------------|
| "Clean code" | Specific principle (SRP, LoD) |
| "Best practice" | Cited guideline or measured benefit |
| "Should be" | Evidence-based observation |
| "More maintainable" | Specific metric (coupling, complexity) |
| "Industry standard" | Named standard (RESTful, OAuth 2.0) |

## Security Checks

### Input Validation

**1. Boundary Validation:**
```python
# Check: All external inputs validated
@validate_input
def create_user(email: str, age: int):
    if not is_valid_email(email):
        raise ValidationError("Invalid email")
    if not (0 < age < 150):
        raise ValidationError("Invalid age")
```

**Search:**
```bash
# Find unvalidated endpoints
grep -rn "@app.route\|@api" src/ -A 10 | grep -v "validate\|check\|verify"
```

**2. SQL Injection Prevention:**
```python
# Bad
query = f"SELECT * FROM users WHERE id = {user_id}"

# Good
query = "SELECT * FROM users WHERE id = ?"
cursor.execute(query, (user_id,))
```

**Search:**
```bash
# Find string interpolation in SQL
grep -rn "f\".*SELECT\|\".*SELECT.*{" src/
```

**3. XSS Prevention:**
```python
# Check for auto-escaping
# Framework default: Flask (manual), Django (auto)
```

### Least Privilege

**1. Minimum Permissions:**
```python
# Bad: Admin for everything
db_user = "admin"

# Good: Specific roles
db_user = "app_readonly"  # For queries
db_user = "app_writer"    # For mutations
```

**2. Capability Checks:**
```bash
# Find permission checks
grep -rn "check_permission\|require_role\|authorize" src/
```

### Error Handling

**1. No Sensitive Leaks:**
```python
# Bad
except Exception as e:
    return {"error": str(e)}  # May expose internals

# Good
except Exception as e:
    logger.error(f"Operation failed: {e}")
    return {"error": "Operation failed"}
```

**2. Proper Logging:**
```bash
# Check logging coverage
grep -rn "logger\.\(error\|warning\)" src/ | wc -l
```

## Performance Checks

### Performance Budgets

Define limits:
```yaml
response_time:
  p50: 100ms
  p95: 500ms
  p99: 1000ms

database_queries:
  max_per_request: 10

memory:
  max_heap: 512MB
```

### N+1 Query Detection

```python
# Bad: N+1 queries
for user in users:
    user.get_orders()  # Query per user

# Good: Eager loading
users = User.query.options(joinedload('orders')).all()
```

**Search:**
```bash
# Find potential N+1
grep -rn "for.*in.*:" src/ -A 3 | grep "get_\|fetch_\|find_"
```

### Caching Strategy

**Check for:**
- Cache key design
- TTL configuration
- Invalidation strategy
- Cache stampede prevention

```bash
# Find caching usage
grep -rn "@cache\|cache.get\|cache.set" src/
```

### Index Coverage

```bash
# Check migrations for indexes
grep -r "CREATE INDEX\|add_index" migrations/

# Find missing indexes (slow queries)
# Review query logs, not static analysis
```

## Integration with Architecture Review

Use this module during Step 4 (Principle Checks):
1. Run LoD detection searches
2. Check for anti-slop patterns
3. Verify AI assistance guardrails
4. Execute security checks
5. Validate performance budgets
6. Document violations with evidence
7. Recommend specific fixes with file/line references
