# Hook Evaluation Criteria

Detailed scoring rubric and quality gates for hook evaluation.

## Mathematical Foundation

This evaluation framework follows Multi-Criteria Decision Analysis (MCDA) best practices:

- **Normalization**: Vector normalization for scale invariance ([full methodology](../../skills-eval/modules/multi-metric-evaluation-methodology.md))
- **Weighting**: Security-first weights with stakeholder validation
- **Aggregation**: Weighted sum with penalty-based security scoring
- **Validation**: Sensitivity analysis on non-security weights

**Documentation**: See [Multi-Metric Evaluation Methodology](../../skills-eval/modules/multi-metric-evaluation-methodology.md) for complete mathematical foundation.

## Scoring System (100 points total)

### Security Analysis (30 points)

**Vulnerability Detection:**
- Critical vulnerabilities: -15 points each
- High-risk issues: -8 points each
- Medium-risk issues: -4 points each
- Low-risk issues: -1 point each

**Security Checklist:**

| Check | Severity | Points Lost |
|-------|----------|-------------|
| Dynamic code evaluation with user input | Critical | -15 |
| Command injection vulnerability | Critical | -15 |
| Unvalidated file path access | High | -8 |
| Secrets/credentials in code | High | -8 |
| Missing input validation | Medium | -4 |
| Overly permissive patterns | Medium | -4 |
| No rate limiting | Low | -1 |
| Verbose error messages exposing internals | Low | -1 |

### Performance Analysis (25 points)

| Metric | Max Points | Criteria |
|--------|------------|----------|
| Execution time efficiency | 10 | PreToolUse <100ms, PostToolUse <200ms |
| Memory usage optimization | 8 | <50MB for simple hooks, <100MB for complex |
| I/O operation efficiency | 4 | Minimal file/network operations |
| Resource cleanup | 3 | Proper cleanup of handles, connections |

**Performance Thresholds:**

```yaml
pre_tool_use:
  excellent: <50ms
  good: <100ms
  acceptable: <200ms
  poor: >200ms

post_tool_use:
  excellent: <100ms
  good: <200ms
  acceptable: <500ms
  poor: >500ms

memory:
  excellent: <25MB
  good: <50MB
  acceptable: <100MB
  poor: >100MB
```

### Compliance Analysis (20 points)

| Aspect | Max Points | Requirements |
|--------|------------|--------------|
| Structure compliance | 8 | Valid JSON/Python, correct schema |
| Documentation completeness | 6 | Purpose, parameters, return values documented |
| Error handling | 4 | All exceptions caught, meaningful messages |
| Best practices | 2 | Follows hook authoring guidelines |

**Structure Requirements:**

- JSON hooks: Valid JSON schema with required fields
- Python hooks: Type hints, async/await patterns
- Matcher patterns: Valid regex, appropriate scope

### Reliability Analysis (15 points)

| Aspect | Max Points | Requirements |
|--------|------------|--------------|
| Error handling robustness | 6 | Graceful handling of all error conditions |
| Timeout management | 4 | Appropriate timeouts configured |
| Idempotency | 3 | Safe to retry without side effects |
| Graceful degradation | 2 | Falls back safely on failure |

**Reliability Checklist:**

- [ ] Hook returns valid response on all code paths
- [ ] Exceptions are caught and handled
- [ ] Timeout is configured appropriately
- [ ] Hook can be called multiple times safely
- [ ] Failure doesn't break agent operation

### Maintainability (10 points)

| Aspect | Max Points | Requirements |
|--------|------------|--------------|
| Code structure | 4 | Clear, modular, single responsibility |
| Documentation clarity | 3 | Purpose and behavior well explained |
| Modularity | 2 | Reusable components, no duplication |
| Test coverage | 1 | Tests exist for key functionality |

## Quality Levels

| Score | Level | Description |
|-------|-------|-------------|
| 91-100 | Excellent | Production-ready, follows all best practices |
| 76-90 | Good | Minor improvements suggested |
| 51-75 | Acceptable | Some issues requiring attention |
| 26-50 | Poor | Significant issues need addressing |
| 0-25 | Critical | Major security or reliability issues |

## Quality Gates

Default thresholds for CI/CD integration:

```yaml
quality_gates:
  security_score: ">= 80"
  performance_score: ">= 70"
  compliance_score: ">= 85"
  reliability_score: ">= 85"
  overall_score: ">= 75"
  max_critical_issues: 0
  max_high_issues: 2
```

### Sensitivity Analysis Requirements

Security weights are non-negotiable, but other weights should be validated:

```yaml
sensitivity_analysis:
  # Security weights are fixed (non-negotiable)
  fixed_weights: ["security_analysis"]

  # Other weights tested for sensitivity
  test_weights: ["performance", "compliance", "reliability", "maintainability"]
  variation: 0.20  # ±20% weight variation

  requirements:
    stable_rankings: true  # Rankings shouldn't change (except security)
    critical_weights_identified: true  # Document sensitive weights
```

See [Sensitivity Analysis](../../skills-eval/modules/multi-metric-evaluation-methodology.md#sensitivity-analysis) for implementation details.

### Gate Behaviors

| Gate | Failure Action |
|------|----------------|
| `security_score` | Block deployment, require review |
| `performance_score` | Warn, suggest optimization |
| `compliance_score` | Block until documentation complete |
| `reliability_score` | Block deployment |
| `max_critical_issues` | Immediate block |

## Issue Classification

### Critical Issues (Immediate Action Required)

- Dynamic code evaluation with untrusted input
- Command injection vulnerabilities
- Credential exposure
- Unhandled exceptions that break agent

### High Issues (Address Before Release)

- Missing input validation
- Performance exceeds thresholds
- Missing error handling
- Insecure file operations

### Medium Issues (Address Soon)

- Missing documentation
- Suboptimal patterns
- Minor performance concerns
- Code style violations

### Low Issues (Nice to Fix)

- Minor documentation gaps
- Formatting inconsistencies
- Optimization opportunities
- Enhanced logging suggestions

## Evaluation Report Format

### Summary Format

```
=== Hooks Evaluation Report ===
Plugin: {name} (v{version})
Scope: {scope}
Total hooks: {count} ({json_count} JSON, {python_count} Python)

=== Scores ===
Security:      {score}/100 ({level})
Performance:   {score}/100 ({level})
Compliance:    {score}/100 ({level})
Reliability:   {score}/100 ({level})
Maintainability: {score}/100 ({level})
────────────────────────────────
Overall:       {score}/100 ({level})

=== Issues ===
Critical: {count}
High: {count}
Medium: {count}
Low: {count}
```

### Detailed Format

Includes per-hook breakdown:

```
=== Hook: {hook_path} ===
Type: {json|python}
Event: {PreToolUse|PostToolUse|...}
Matcher: {pattern|universal}

Security Issues:
  [{severity}] Line {n}: {description}

Performance:
  Estimated time: {ms}ms (threshold: {threshold}ms)
  Memory usage: {mb}MB (threshold: {threshold}MB)

Recommendations:
  1. {recommendation}
  2. {recommendation}
```

## Customization

### Per-Plugin Configuration

Create `.hooks-eval.yaml` in plugin root:

```yaml
hooks_eval:
  # Override security thresholds
  security_thresholds:
    critical_score: 80
    high_score: 70

  # Override performance thresholds
  performance_thresholds:
    pre_tool_use_max_ms: 100
    post_tool_use_max_ms: 200
    max_memory_mb: 50

  # Compliance requirements
  compliance_requirements:
    require_documentation: true
    require_error_handling: true
    require_timeout_config: true

  # Custom rules
  custom_rules:
    - name: "no-hardcoded-secrets"
      pattern: "password|secret|token"
      severity: "high"
    - name: "require-shebang"
      pattern: "^#!"
      file_types: [".sh", ".py"]
      severity: "medium"

  # Excluded paths
  exclude_paths:
    - "hooks/experimental/*"
    - "hooks/deprecated/*"
```

### Severity Overrides

Override default severity for specific patterns:

```yaml
severity_overrides:
  - pattern: "subprocess.run"
    default_severity: "high"
    override_severity: "medium"
    reason: "Safe usage verified in review"
```
