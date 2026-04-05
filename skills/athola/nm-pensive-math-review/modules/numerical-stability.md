---
parent_skill: pensive:math-review
load_priority: high
estimated_tokens: 400
---

# Numerical Stability Analysis

## Conditioning

**Condition Numbers**
- Measure sensitivity to input perturbations
- High condition number = unstable computation
- Use scaled condition numbers when possible

**Sensitivity Analysis**
- Perturb inputs systematically
- Measure output variation
- Document acceptable tolerance ranges

## Precision Management

**Floating-Point Error Propagation**
```python
# Bad: Accumulating small values into large
total = 1e15
for x in small_values:
    total += x  # Precision lost

# Good: Kahan summation or sort first
sorted_values = sorted(small_values)
total = sum(sorted_values)  # Better precision
```

**Catastrophic Cancellation**
```python
# Bad: Subtracting similar values
result = (a + epsilon) - a  # Catastrophic cancellation

# Good: Reformulate to avoid
result = epsilon  # Direct computation
```

**Overflow/Underflow Prevention**
- Check dynamic range before operations
- Use log-space for very large/small products
- Normalize intermediate results
- Scale inputs to manageable ranges

## Scaling and Normalization

**Dynamic Range Handling**
- Pre-scale inputs to [0, 1] or [-1, 1]
- Use log-transforms for exponential data
- Document scaling factors and units

**Normalization Requirements**
- L1/L2 normalization for vectors
- Feature scaling for ML inputs
- Unit conversions for physical quantities

## Randomness Control

**Reproducibility**
- Set explicit random seeds
- Document PRNG algorithms used
- Version lock numerical libraries
- Test deterministic behavior

**Seed Management**
```python
# Good: Explicit seed control
import numpy as np
np.random.seed(42)

# Better: Isolated RNG state
rng = np.random.RandomState(42)
samples = rng.normal(0, 1, size=100)
```

## Complexity Analysis

Compare algorithmic complexity before/after changes:

```
Before: O(n²) time, O(n) space
After:  O(n log n) time, O(n) space
Improvement: 100x faster for n=1000
```

Document:
- Time complexity
- Space complexity
- Cache behavior
- Parallelization potential

## Uncertainty Quantification

Required for:
- Safety-critical systems
- Data-driven components
- High-stakes decisions
- Regulatory compliance

Methods:
- Monte Carlo sampling
- Bootstrap confidence intervals
- Sensitivity analysis
- Error propagation formulas

## Stability Checklist

- [ ] Condition number < 1e6
- [ ] Precision loss < 1e-10
- [ ] No catastrophic cancellation
- [ ] Overflow/underflow prevented
- [ ] Scaling applied appropriately
- [ ] Random seeds controlled
- [ ] Complexity acceptable
- [ ] Uncertainty quantified (if required)
