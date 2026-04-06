---
parent_skill: pensive:math-review
load_priority: medium
estimated_tokens: 350
---

# Testing Strategies for Mathematical Code

## Edge Case Coverage

**Domain Boundaries**
```python
# Bad: Undefined for negative
result = math.sqrt(value)

# Good: Validate domain
def safe_sqrt(value: float) -> float:
    if value < 0:
        raise ValueError("sqrt requires non-negative input")
    return math.sqrt(value)

# Test edge cases
@pytest.mark.parametrize("value", [0, 1e-100, 1e100, float('inf')])
def test_sqrt_boundaries(value):
    result = safe_sqrt(value)
    assert result >= 0
```

**Special Values**
- Zero
- One
- Infinity
- NaN
- Very small (underflow)
- Very large (overflow)
- Negative values
- Empty inputs

## Property-Based Testing

**Hypothesis Framework**
```python
from hypothesis import given, strategies as st

@given(st.floats(min_value=0, max_value=1e6))
def test_sqrt_inverse(x):
    """sqrt(x)² should equal x"""
    result = safe_sqrt(x)
    assert abs(result * result - x) < 1e-10 * x
```

**Invariant Testing**
- Symmetry properties
- Associativity/commutativity
- Idempotence
- Conservation laws
- Monotonicity

## Benchmark Testing

**Performance Validation**
```bash
pytest tests/math/ --benchmark-only
pytest tests/math/ --benchmark-compare=baseline
```

**Regression Detection**
```python
def test_algorithm_performance(benchmark):
    """validate O(n log n) complexity maintained"""
    n = 10000
    data = np.random.rand(n)

    result = benchmark(algorithm, data)

    # Verify result correctness
    assert len(result) == n
    # Performance constraint
    assert benchmark.stats['mean'] < 0.1  # seconds
```

**Complexity Verification**
- Time scaling tests
- Memory profiling
- Cache behavior
- Parallel efficiency

## Reproducibility Testing

**Deterministic Results**
```python
def test_reproducibility():
    """Same seed produces same results"""
    np.random.seed(42)
    result1 = monte_carlo_simulation()

    np.random.seed(42)
    result2 = monte_carlo_simulation()

    np.testing.assert_array_equal(result1, result2)
```

**Version Pinning**
```toml
# pyproject.toml
[tool.poetry.dependencies]
numpy = "==1.24.0"  # Pin for reproducibility
scipy = "==1.10.0"
```

## Reference Implementation Tests

**Golden Master Testing**
```python
def test_against_reference():
    """Compare with NumPy/SciPy reference"""
    x = np.linspace(0, 10, 100)

    our_result = our_implementation(x)
    reference_result = scipy.special.reference_function(x)

    np.testing.assert_allclose(
        our_result,
        reference_result,
        rtol=1e-10,
        atol=1e-12
    )
```

**Cross-Validation**
- Multiple independent implementations
- Different algorithms
- Analytical solutions (when available)
- Published test cases

## Numerical Accuracy Tests

**Tolerance Specifications**
```python
# Absolute tolerance
np.testing.assert_allclose(result, expected, atol=1e-10)

# Relative tolerance
np.testing.assert_allclose(result, expected, rtol=1e-8)

# Both
np.testing.assert_allclose(
    result, expected,
    rtol=1e-8, atol=1e-10
)
```

**ULP (Units in Last Place) Testing**
```python
# For critical floating-point comparisons
assert abs(a - b) <= 2 * np.finfo(float).eps * max(abs(a), abs(b))
```

## Evidence Logging

**Execution Records**
```bash
# Run tests with output capture
pytest tests/math/ -v --tb=short > test_results.txt

# Benchmark with JSON output
pytest tests/math/ --benchmark-json=benchmark.json

# Execute derivation notebooks
jupyter nbconvert --execute derivation.ipynb \
    --to html --output verification.html
```

**Documentation Template**
```markdown
## Test Evidence

### Unit Tests
- **Command**: `pytest tests/math/ -v`
- **Result**: 47/47 passed
- **Coverage**: 94%
- **Date**: 2025-12-06

### Benchmarks
- **Command**: `pytest tests/math/ --benchmark-only`
- **Mean time**: 23.4ms (±1.2ms)
- **Baseline**: 24.1ms
- **Improvement**: 3%

### Derivation Verification
- **Notebook**: derivation.ipynb
- **Status**: All cells executed successfully
- **Symbolic checks**: Passed
- **Reference comparison**: Within tolerance
```

## Test Organization

```
tests/math/
├── test_correctness.py       # Basic functionality
├── test_edge_cases.py        # Boundary conditions
├── test_properties.py        # Hypothesis tests
├── test_benchmarks.py        # Performance
├── test_stability.py         # Numerical stability
├── test_references.py        # Golden masters
└── fixtures/
    ├── test_data.npz
    └── reference_results.json
```

## Testing Checklist

- [ ] Edge cases covered (0, ±∞, NaN)
- [ ] Property tests for invariants
- [ ] Benchmark tests for performance
- [ ] Reproducibility verified
- [ ] Reference implementation compared
- [ ] Tolerances documented
- [ ] Evidence logged and dated
- [ ] Coverage > 90% for math code
