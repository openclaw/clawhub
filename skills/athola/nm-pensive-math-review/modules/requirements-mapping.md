---
parent_skill: pensive:math-review
load_priority: medium
estimated_tokens: 300
---

# Requirements Mapping

## Mathematical Invariants

Translate requirements into verifiable mathematical properties:

| Requirement | Invariant | Test Coverage |
|-------------|-----------|---------------|
| Positive output | f(x) > 0 ∀ x ∈ domain | Property test |
| Conservation | Σ mass_in = Σ mass_out | Unit test |
| Bounded error | \|ε\| < 1e-6 | Benchmark |
| Monotonicity | x₁ < x₂ ⟹ f(x₁) ≤ f(x₂) | Property test |
| Idempotence | f(f(x)) = f(x) | Unit test |

## Pre-conditions

**Input Validation**
```python
def compute(x: float, n: int) -> float:
    """Compute function with documented preconditions.

    Preconditions:
    - x ≥ 0 (non-negative input)
    - n > 0 (positive integer)
    - x < 1e10 (prevent overflow)
    """
    if x < 0:
        raise ValueError("x must be non-negative")
    if n <= 0:
        raise ValueError("n must be positive")
    if x >= 1e10:
        raise ValueError("x must be < 1e10")
    # ... implementation
```

**Domain Constraints**
- Valid input ranges
- Type requirements
- Dimensional consistency
- Unit compatibility

## Post-conditions

**Output Guarantees**
```python
def normalize(vector: np.ndarray) -> np.ndarray:
    """Normalize vector to unit length.

    Postconditions:
    - ||result|| = 1.0 (± 1e-10)
    - result ∥ vector (parallel)
    """
    result = vector / np.linalg.norm(vector)
    assert abs(np.linalg.norm(result) - 1.0) < 1e-10
    return result
```

**Invariant Preservation**
- Conservation laws maintained
- Bounds respected
- Relationships preserved

## Conservation Laws

**Physical Conservation**
- Mass conservation
- Energy conservation
- Momentum conservation
- Charge conservation

**Numerical Conservation**
- Probability sums to 1.0
- Symmetry preservation
- Balance equations

## Monotonicity Guarantees

**Increasing Functions**
```python
# Property test
@given(st.floats(min_value=0, max_value=100))
def test_monotonic_increasing(x1, x2):
    assume(x1 < x2)
    assert f(x1) <= f(x2)
```

**Convexity/Concavity**
- Second derivative tests
- Jensen's inequality
- Midpoint properties

## Probabilistic Bounds

**Confidence Intervals**
- Document confidence levels (95%, 99%)
- Specify interval type (credible, confidence)
- Test coverage probabilities

**Error Probabilities**
- Type I/II error rates
- False positive/negative rates
- Statistical power

## Coverage Gap Analysis

Identify untested invariants:

```markdown
### Coverage Gaps

**Missing Tests**
- [ ] Boundary condition: x = 0
- [ ] Overflow case: x > 1e15
- [ ] Negative input handling
- [ ] Conservation at t → ∞

**Insufficient Coverage**
- [ ] Only 3 test cases for n-dimensional invariant
- [ ] No property tests for monotonicity
- [ ] Missing edge case: empty input
```

## Documentation Template

```python
def algorithm(inputs) -> outputs:
    """Brief description.

    Mathematical Properties:
    - Preconditions: [domain constraints]
    - Postconditions: [guaranteed properties]
    - Invariants: [preserved relationships]
    - Complexity: [time/space bounds]
    - Stability: [condition number, error bounds]

    References:
    - [Citation to algorithm source]
    """
```

## Mapping Checklist

- [ ] Requirements translated to invariants
- [ ] Pre-conditions documented
- [ ] Post-conditions verified
- [ ] Conservation laws tested
- [ ] Monotonicity/convexity checked
- [ ] Probabilistic bounds specified
- [ ] Coverage gaps identified
- [ ] All properties have tests
