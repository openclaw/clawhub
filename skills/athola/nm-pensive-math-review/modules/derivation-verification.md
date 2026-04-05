---
parent_skill: pensive:math-review
load_priority: high
estimated_tokens: 350
---

# Derivation Verification

## Re-derive Critical Formulas

**Symbolic Verification**
- Use Computer Algebra Systems (SymPy, Mathematica, Maple)
- Confirm algebraic manipulations
- Verify calculus operations (derivatives, integrals)
- Check limit behavior

**Computational Notebooks**
```python
# Example: Verify gradient computation
import sympy as sp
x, y = sp.symbols('x y')
f = x**2 + y**2
grad_f = [sp.diff(f, var) for var in [x, y]]
# Compare with implementation
```

**Probabilistic Reasoning**
- Verify conditional probability formulas
- Check Bayes rule applications
- Confirm expectation/variance calculations
- Validate distribution properties

## Challenge Approximations

**Series Truncation**
- Document truncation order (e.g., O(h³))
- Estimate truncation error
- Test convergence with different orders
- Provide error bounds across domain

**Linearizations**
- Identify linearization points
- Estimate valid domain size
- Test against full nonlinear model
- Document approximation quality

**Surrogate Models**
- Compare surrogate to ground truth
- Quantify approximation error
- Document training/validation data
- Test extrapolation behavior

**Error Bounds**
- Derive theoretical error bounds
- Verify empirically
- Document worst-case scenarios
- Test at domain boundaries

## Authoritative References

**Standards and Frameworks**
- **NASA-STD-7009**: Modeling and Simulation V&V
- **ASME V&V 20**: Verification & Validation in CFD/HT
- **ASME V&V 10**: Guide for V&V in Computational Solid Mechanics
- **SIAM**: Reproducibility checklists
- **IEEE 754**: Floating-point arithmetic
- **NIST**: Uncertainty quantification guidelines

**Academic Sources**
- Peer-reviewed papers (DOI links)
- Textbooks (edition and page numbers)
- Technical reports
- Conference proceedings

**Implementation References**
- Reference implementations (NumPy, SciPy, GSL)
- Algorithm papers (original sources)
- Numerical recipes
- Domain-specific libraries

## Document Conflicts

When implementation deviates from standards:

```markdown
### Deviation: [Brief title]
- **Standard**: NASA-STD-7009 Section 3.4.2
- **Requirement**: Monte Carlo with n≥1000 samples
- **Implementation**: n=100 samples
- **Justification**: Performance constraints
- **Risk**: Reduced confidence intervals
- **Mitigation**: Document uncertainty, flag results
- **Owner**: [name]
- **Due date**: [date]
```

## Citation Format

```markdown
## References

[1] Wilkinson, J.H. (1963). *Rounding Errors in Algebraic Processes*.
    Prentice-Hall. Chapter 3.

[2] NASA-STD-7009A. (2016). *Standard for Models and Simulations*.
    Section 4.2: Verification Requirements.

[3] Goldberg, D. (1991). "What Every Computer Scientist Should Know
    About Floating-Point Arithmetic". *ACM Computing Surveys*, 23(1).
    DOI: 10.1145/103162.103163
```

## Verification Checklist

- [ ] Formulas re-derived from first principles
- [ ] Symbolic verification completed (CAS)
- [ ] Approximation order documented
- [ ] Error bounds derived and tested
- [ ] Authoritative references cited
- [ ] Deviations from standards documented
- [ ] Conflicts resolved or flagged
- [ ] Implementation matches theory
