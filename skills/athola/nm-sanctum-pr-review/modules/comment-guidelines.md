# Code Comment Quality Guidelines

Guidance on when and how to write effective code comments that add value without bloat.

## Core Philosophy: Why, Not What

Good comments explain **why** code exists, not **what** it does. The code already shows what it does.

| Comment Type | Value | Example |
|--------------|-------|---------|
| **Why** | High | "Use exponential backoff to handle transient API failures" |
| **What** | Low | "Loop through the array" |
| **Context** | High | "AWS Lambda has 15-min timeout, so max 3 retries" |
| **Obvious** | Negative | "Increment counter by 1" |

## When Comments Are Warranted

### Require Comments For

| Scenario | Reason | Example |
|----------|--------|---------|
| **Non-obvious behavior** | Future readers will wonder why | Edge case handling |
| **Business logic decisions** | Domain knowledge not in code | "Tax calculated per 2024 regulations" |
| **Performance optimizations** | Why this approach over simpler one | "O(1) lookup vs O(n) iteration" |
| **Workarounds** | Temporary fixes need context | "TODO: Remove after #123 fixed" |
| **Algorithm complexity** | Complex logic needs explanation | Mathematical formulas |
| **External constraints** | Dependencies, APIs, limits | "API rate limit: 100 req/min" |

### Don't Require Comments For

| Scenario | Alternative |
|----------|-------------|
| Self-explanatory code | Good naming |
| Simple CRUD operations | Patterns speak |
| Well-named functions | Function name = documentation |
| Standard patterns | Convention over comment |

## Examples

### Good Comments (Explain Why)

```python
def retry_with_backoff(max_attempts=3):
    """Retry with exponential backoff for transient failures.

    AWS Lambda has a 15-minute timeout, so max_attempts=3 prevents
    exceeding this limit with our 1s/2s/4s backoff strategy.
    """
    ...

# Use set for O(1) membership testing instead of list O(n)
# Critical for processing 100k+ items in batch jobs
seen_ids = set()
```

### Bad Comments (Explain What - Avoid These)

```python
# Bad: Restates code
i = 0  # Set i to 0

# Bad: Obvious from code
if user_input == "":  # Check if user_input is empty string
    return DEFAULT_VALUE

# Bad: Redundant docstring
def add(a, b):
    """Add two numbers and return the result."""
    return a + b
```

## Anti-Patterns

### Over-Commenting (Bloat)

**Problem**: Too many comments obscure code and become maintenance burden.

**Symptoms**:
- Comment-to-code ratio > 1:3
- Comments on every line
- Comments restating variable names

**Solution**: Improve code clarity instead. Better names, smaller functions.

### Stale Comments (Out of Sync)

**Problem**: Comments that don't match current code behavior are worse than no comments.

**Symptoms**:
- Function behavior changed, comment didn't
- TODO comments for completed work
- References to deleted code

**Solution**: Update comments with code changes. Delete outdated TODOs.

### Commented-Out Code

**Problem**: Dead code clutters codebase and confuses readers.

**Solution**: Delete it. Git preserves history.

## Docstring Conventions

### When Required

- Public functions/methods
- Classes with non-obvious purpose
- Modules with significant complexity

### Format (Python)

```python
def process_order(order: Order, apply_discount: bool = False) -> Receipt:
    """Process an order and generate a receipt.

    Validates inventory, applies pricing rules, and records transaction.

    Args:
        order: The order to process.
        apply_discount: Whether to apply member discount (default: False).

    Returns:
        Receipt with itemized charges and total.

    Raises:
        InsufficientStockError: If any item is out of stock.
        PaymentFailedError: If payment processing fails.
    """
```

### Format (TypeScript)

```typescript
/**
 * Process an order and generate a receipt.
 *
 * Validates inventory, applies pricing rules, and records transaction.
 *
 * @param order - The order to process
 * @param applyDiscount - Whether to apply member discount
 * @returns Receipt with itemized charges and total
 * @throws InsufficientStockError if any item is out of stock
 */
function processOrder(order: Order, applyDiscount = false): Receipt {
```

## Review Checklist

When reviewing code comments:

- [ ] Comments explain WHY, not WHAT
- [ ] No redundant comments restating code
- [ ] Complex logic is documented
- [ ] Business rules have context
- [ ] No stale/outdated comments
- [ ] No commented-out code
- [ ] Public APIs have docstrings
- [ ] TODOs have issue references

## Integration with KISS/YAGNI

From `conserve:code-quality-principles`:

- **KISS**: If code needs extensive comments to understand, simplify the code
- **YAGNI**: Don't comment for hypothetical future readers - comment for current needs

## Summary

| Situation | Action |
|-----------|--------|
| Simple, clear code | No comment needed |
| Non-obvious behavior | Comment the WHY |
| Business logic | Document the rule source |
| Complex algorithm | Explain approach/tradeoffs |
| Workaround | Note why and when to remove |
| Dead code | Delete, don't comment out |
