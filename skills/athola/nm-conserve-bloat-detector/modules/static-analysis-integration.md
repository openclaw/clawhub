---
module: static-analysis-integration
category: tier-2
dependencies: [Bash, Read]
estimated_tokens: 150
---

# Static Analysis Integration Module

Bridge Tier 1 heuristics with Tier 2 programmatic analysis. Auto-detects tools and falls back gracefully.

## Tool Detection

```bash
# Auto-detect available tools
TOOLS=()
command -v vulture &>/dev/null && TOOLS+=("vulture")
command -v deadcode &>/dev/null && TOOLS+=("deadcode")
command -v autoflake &>/dev/null && TOOLS+=("autoflake")
command -v knip &>/dev/null && TOOLS+=("knip")
command -v sonar-scanner &>/dev/null && TOOLS+=("sonarqube")

[ ${#TOOLS[@]} -gt 0 ] && echo "Tier 2 capable" || echo "Tier 1 only"
```

## Python Tools

| Tool | Strength | Confidence | Command |
|------|----------|------------|---------|
| **vulture** | Dead code detection | 80-95% | `vulture . --min-confidence 80` |
| **deadcode** | Fast, auto-fix | 85% | `deadcode --dry` |
| **autoflake** | Import cleanup | 95% | `autoflake --check -r .` |

### Vulture (Recommended)
```bash
vulture . --min-confidence 80 --exclude=.venv,__pycache__,.git,node_modules
```
- 90-100%: Safe to remove
- 80-89%: Review first
- <80%: Investigate

### autoflake (Imports)
```bash
autoflake --check --remove-all-unused-imports --expand-star-imports -r .
# Fix: add --in-place
```
**Impact:** 40-70% startup time reduction

## JavaScript/TypeScript

| Tool | Strength | Confidence | Command |
|------|----------|------------|---------|
| **knip** | Files, exports, deps | 95% | `knip --include files,exports` |

```bash
knip --include files,exports,dependencies --reporter json > knip-report.json
```

**Tree-shaking prereqs:**
- `"type": "module"` in package.json
- Avoid `export * from` barrel patterns

## Multi-Language

**SonarQube** (enterprise): Duplication, complexity, code smells
```bash
sonar-scanner -Dsonar.sources=. -Dsonar.exclusions="**/node_modules/**"
```

## Tool Selection

```python
PRIORITY = {'python': ['vulture', 'deadcode'], 'javascript': ['knip']}
tool = next((t for t in PRIORITY.get(lang, []) if t in available), 'heuristic')
```

## Confidence Boosting

When heuristic + tool agree: boost confidence by 15% (max 95%)

```yaml
# Output format
file: src/utils/helpers.py
type: function
name: calculate_legacy
confidence: 95%
sources: [heuristic, vulture]
action: DELETE
```

## Graceful Degradation

No tools? Fall back to `@module:code-bloat-patterns` heuristics.

## Related
- `code-bloat-patterns` - Heuristic fallbacks
- `bloat-auditor` - Orchestrates tool execution
