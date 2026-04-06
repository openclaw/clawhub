---
module: architectural-fit
description: Assess code alignment with architectural paradigm and coupling principles
parent_skill: pensive:code-refinement
category: code-quality
tags: [architecture, coupling, cohesion, paradigm, alignment]
dependencies: [Read, Grep, Glob]
estimated_tokens: 400
---

# Architectural Fit Module

Evaluate whether code structure aligns with the project's architectural paradigm and coupling/cohesion principles.

## Two-Mode Operation

### Mode 1: Paradigm-Aware (archetypes plugin installed)

When `archetypes` is available, detect the project's paradigm and check alignment:

```
Skill(archetypes:architecture-paradigms) -> detect paradigm -> check violations
```

Supported paradigms from archetypes:
- Functional Core / Imperative Shell
- Hexagonal (Ports & Adapters)
- Layered Architecture
- Pipeline / Data Flow
- Modular Monolith
- Event-Driven
- Client-Server
- Microkernel
- CQRS/ES

### Mode 2: Principle-Based (fallback, no archetypes)

Check universal coupling/cohesion principles without paradigm detection:

- Dependency direction (no circular deps)
- Layer violations (UI calling DB directly)
- Cohesion (related code grouped together)
- Encapsulation (no leaking internals)

## Detection: Coupling Violations

### 1. Circular Dependencies

```bash
# Python: Find circular imports (heuristic)
grep -rn "^from \|^import " --include="*.py" . | \
  awk -F: '{file=$1; gsub(/.*from /,"",$3); gsub(/ import.*/,"",$3); print file, $3}' | \
  sort | while read a b; do
    grep -q "from.*$(basename $a .py)" "$b.py" 2>/dev/null && \
      echo "CIRCULAR: $a <-> $b"
  done
```

### 2. Layer Violations

Common layer boundaries to check:
- Presentation should not import from data/persistence
- Domain/business logic should not depend on framework
- Utilities should not depend on domain

```bash
# Find cross-layer imports (convention: src/{layer}/)
# Customize layer names per project
for violation in \
  "handlers.*import.*models\." \
  "views.*import.*database" \
  "api.*import.*sql\|cursor\|query"; do
  grep -rn "$violation" --include="*.py" . 2>/dev/null && echo "LAYER_VIOLATION: $violation"
done
```

### 3. Feature Envy

A method that uses more features of another class than its own:

```bash
# Heuristic: methods with many external references
# Look for methods where self.X appears less than other_obj.Y
grep -A20 "def " --include="*.py" -r . | \
  awk '/def /{fn=$0; self=0; other=0} /self\./{self++} /[a-z]+\./{other++} /^$/{if(other>self*2 && other>3) print "FEATURE_ENVY:", fn}'
```

### 4. Inappropriate Intimacy

Classes that access each other's private members:

```bash
# Find access to _private members from outside class
grep -rn "\._[a-z]" --include="*.py" . | grep -v "self\._\|cls\._\|__init__\|test_" | head -20
```

### 5. Shotgun Surgery Indicators

Changes to one concept require touching many files:

```bash
# Heuristic: functions/classes with same name prefix across many files
grep -rn "^def " --include="*.py" . | sed 's/def //;s/(.*//' | \
  awk -F: '{print $2}' | sed 's/_.*//' | sort | uniq -c | sort -rn | \
  awk '$1>4{print "SCATTERED_CONCEPT ("$1" files):", $2}'
```

## Detection: Cohesion Issues

### Low Cohesion Indicators

```bash
# Files with many unrelated public functions (>8)
grep -c "^def " --include="*.py" -r . | awk -F: '$2>8{print "LOW_COHESION:", $0}'

# Classes with unrelated method groups
# Heuristic: methods that don't reference same instance variables
```

### Module Size Imbalance

```bash
# Find modules that are disproportionately large
find . -name "*.py" -not -path "*/.venv/*" -exec wc -l {} + | \
  sort -rn | head -10
# Flag if largest is >5x the median
```

## Paradigm-Specific Checks

### Functional Core / Imperative Shell
- [ ] Pure functions don't perform I/O
- [ ] Side effects isolated to shell layer
- [ ] Domain logic is testable without mocks

### Hexagonal
- [ ] Ports defined as interfaces/protocols
- [ ] Adapters don't leak into domain
- [ ] Dependency flow: adapters -> ports -> domain

### Layered
- [ ] Dependencies flow downward only
- [ ] No layer bypassing
- [ ] Clear layer boundaries in directory structure

## Scoring

| Pattern | Severity | Confidence |
|---------|----------|------------|
| Circular dependency | HIGH | 90% |
| Layer violation | HIGH | 85% |
| Feature envy (strong) | MEDIUM | 75% |
| Low cohesion (>10 methods) | MEDIUM | 80% |
| Inappropriate intimacy | MEDIUM | 80% |
| Scattered concept | LOW | 65% |
| Module size imbalance | LOW | 70% |

## Output Format

```yaml
finding: architectural-violation
severity: HIGH
type: circular_dependency
locations:
  - file: src/services/user.py
    imports: src/models/user.py
  - file: src/models/user.py
    imports: src/services/user.py
strategy: introduce_interface
paradigm_note: "Violates dependency inversion; extract protocol"
effort: MEDIUM
```
