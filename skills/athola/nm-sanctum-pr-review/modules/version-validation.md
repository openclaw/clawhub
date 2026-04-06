# Version Validation Module

**Purpose:** Enforce version consistency checks in PR reviews to catch version mismatches before merge.

## When to Run

**MANDATORY** for every PR review UNLESS:
- Maintainer explicitly passes `--skip-version-check` flag
- PR is labeled with `skip-version-check` in GitHub
- PR description contains `[skip-version-check]` marker

## Validation Checklist

### 1. Detect Project Type & Version Files

```bash
# Determine project structure
PROJECT_TYPE=""
VERSION_FILES=()

if [[ -f "Cargo.toml" ]]; then
  PROJECT_TYPE="rust"
  VERSION_FILES+=("Cargo.toml")
elif [[ -f "package.json" ]]; then
  PROJECT_TYPE="node"
  VERSION_FILES+=("package.json")
elif [[ -f "pyproject.toml" ]]; then
  PROJECT_TYPE="python"
  VERSION_FILES+=("pyproject.toml")
elif [[ -f ".claude-plugin/marketplace.json" ]]; then
  PROJECT_TYPE="claude-marketplace"
  VERSION_FILES+=(".claude-plugin/marketplace.json")
fi

# Always check CHANGELOG if it exists
[[ -f "CHANGELOG.md" ]] && VERSION_FILES+=("CHANGELOG.md")
[[ -f "CHANGELOG" ]] && VERSION_FILES+=("CHANGELOG")
```

### 2. Check Branch Name for Version Indicator

```bash
# Extract version from branch name if present
BRANCH_NAME=$(gh pr view $PR_NUMBER --json headRefName -q .headRefName)
BRANCH_VERSION=""

# Match patterns: release/1.2.3, version-1.2.3, feature-name-1.2.3, v1.2.3-branch
if echo "$BRANCH_NAME" | grep -qE '[0-9]+\.[0-9]+\.[0-9]+'; then
  BRANCH_VERSION=$(echo "$BRANCH_NAME" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  echo "Branch name indicates version: $BRANCH_VERSION"
fi
```

### 3. Check if Version Changed in PR

```bash
# Get PR diff for version files
VERSION_CHANGED=false
for file in "${VERSION_FILES[@]}"; do
  if gh pr diff $PR_NUMBER --name-only | grep -qF "$file"; then
    if gh pr diff $PR_NUMBER -- "$file" | grep -qE '^\+.*version|^\+.*## \['; then
      VERSION_CHANGED=true
      break
    fi
  fi
done
```

### 4. If Version Changed, Run Full Validation

If `VERSION_CHANGED=true`, perform detailed checks:

#### A. Extract Version from Each Source

```bash
# Example for claude-marketplace
MARKETPLACE_VERSION=$(jq -r '.metadata.version' .claude-plugin/marketplace.json)

# For each plugin in marketplace
jq -r '.plugins[] | "\(.name):\(.version)"' .claude-plugin/marketplace.json > /tmp/marketplace_versions.txt

# For each actual plugin
for plugin_dir in plugins/*/; do
  PLUGIN_NAME=$(basename "$plugin_dir")
  ACTUAL_VERSION=$(jq -r '.version' "$plugin_dir/.claude-plugin/plugin.json" 2>/dev/null || echo "MISSING")
  echo "$PLUGIN_NAME:$ACTUAL_VERSION" >> /tmp/actual_versions.txt
done
```

#### B. Compare Marketplace vs Actual

```bash
# Cross-reference versions
while IFS=: read -r name marketplace_version; do
  actual_version=$(grep "^$name:" /tmp/actual_versions.txt | cut -d: -f2)

  if [[ "$marketplace_version" != "$actual_version" ]]; then
    # BLOCKING ISSUE FOUND
    echo "[B-VERSION] Version mismatch for $name: marketplace=$marketplace_version, actual=$actual_version"
  fi
done < /tmp/marketplace_versions.txt
```

#### C. Verify CHANGELOG Updated

```bash
# Check if CHANGELOG has entry for new version
if [[ -f "CHANGELOG.md" ]]; then
  NEW_VERSION=$(jq -r '.metadata.version' .claude-plugin/marketplace.json)

  if ! grep -q "\[$NEW_VERSION\]" CHANGELOG.md; then
    # BLOCKING ISSUE FOUND
    echo "[B-VERSION] CHANGELOG.md missing entry for version $NEW_VERSION"
  fi

  # Check for release date
  if grep -q "\[$NEW_VERSION\] - Unreleased" CHANGELOG.md; then
    # SUGGESTION
    echo "[G-VERSION] CHANGELOG shows version $NEW_VERSION as Unreleased - update date before merge"
  fi
fi
```

#### D. Validate Branch Name Version Matches Marketplace Version

```bash
# If branch name contains a version, it MUST match the marketplace/project version
if [[ -n "$BRANCH_VERSION" ]]; then
  # Get current project version based on project type
  CURRENT_VERSION=""

  if [[ "$PROJECT_TYPE" == "claude-marketplace" ]]; then
    CURRENT_VERSION=$(jq -r '.metadata.version' .claude-plugin/marketplace.json)
  elif [[ "$PROJECT_TYPE" == "python" ]]; then
    CURRENT_VERSION=$(grep "^version" pyproject.toml | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
  elif [[ "$PROJECT_TYPE" == "node" ]]; then
    CURRENT_VERSION=$(jq -r '.version' package.json)
  elif [[ "$PROJECT_TYPE" == "rust" ]]; then
    CURRENT_VERSION=$(grep "^version" Cargo.toml | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
  fi

  if [[ -n "$CURRENT_VERSION" ]] && [[ "$BRANCH_VERSION" != "$CURRENT_VERSION" ]]; then
    # BLOCKING ISSUE FOUND
    echo "[B-VERSION] Branch name suggests version $BRANCH_VERSION, but marketplace/project version is $CURRENT_VERSION"
    echo "  Branch: $BRANCH_NAME"
    echo "  Expected: Version files should match branch name version"
    echo "  Fix: Update version files to $BRANCH_VERSION OR rename branch to match $CURRENT_VERSION"
  fi
fi
```

#### E. Check README Version References

```bash
# Check if README mentions version
if [[ -f "README.md" ]]; then
  if grep -q "version" README.md; then
    # Extract version mentions
    grep -i "version" README.md | while read -r line; do
      # Check if it references old version
      if echo "$line" | grep -qE "[0-9]+\.[0-9]+\.[0-9]+"; then
        echo "[INFO] README mentions version - verify accuracy"
      fi
    done
  fi
fi
```

### 5. Project-Specific Validations

#### Claude Plugin Marketplace

```bash
# Additional checks for claude-night-market structure
if [[ "$PROJECT_TYPE" == "claude-marketplace" ]]; then

  # Check metadata.version matches all plugin versions (unless independent cycle)
  ECOSYSTEM_VERSION=$(jq -r '.metadata.version' .claude-plugin/marketplace.json)

  # Get independent release plugins from CHANGELOG or docs
  INDEPENDENT_PLUGINS=()
  if grep -q "independent release cycle" CHANGELOG.md; then
    # Extract plugin names marked as independent
    INDEPENDENT_PLUGINS+=($(grep -A2 "independent release cycle" CHANGELOG.md | grep -oE '[a-z-]+' | head -5))
  fi

  # Verify non-independent plugins match ecosystem version
  jq -r '.plugins[] | "\(.name):\(.version)"' .claude-plugin/marketplace.json | while IFS=: read -r name version; do
    # Skip if independent
    if [[ " ${INDEPENDENT_PLUGINS[@]} " =~ " ${name} " ]]; then
      continue
    fi

    if [[ "$version" != "$ECOSYSTEM_VERSION" ]]; then
      echo "[B-VERSION] Plugin $name should be $ECOSYSTEM_VERSION (ecosystem version), but is $version"
    fi
  done
fi
```

#### Python Projects

```bash
if [[ "$PROJECT_TYPE" == "python" ]]; then
  # Check __version__ in source
  if [[ -d "src" ]]; then
    VERSION_PY=$(find src -name "__init__.py" -exec grep -l "__version__" {} \; | head -1)
    if [[ -n "$VERSION_PY" ]]; then
      CODE_VERSION=$(grep "__version__" "$VERSION_PY" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
      TOML_VERSION=$(grep "^version" pyproject.toml | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')

      if [[ "$CODE_VERSION" != "$TOML_VERSION" ]]; then
        echo "[B-VERSION] __version__ ($CODE_VERSION) doesn't match pyproject.toml ($TOML_VERSION)"
      fi
    fi
  fi
fi
```

## Classification of Version Issues

All version mismatches are **BLOCKING** unless explicitly waived:

| Issue Type | Severity | Rationale |
|------------|----------|-----------|
| Branch name version ≠ marketplace/project version | BLOCKING | Branch naming indicates intended version - mismatch suggests incomplete version bump |
| Version mismatch between files | BLOCKING | Breaks installation/packaging |
| Missing CHANGELOG entry | BLOCKING | Required for release audit trail |
| Marketplace vs plugin version mismatch | BLOCKING | Plugin installation will fail |
| README references old version | IN-SCOPE | Documentation accuracy |
| __version__ doesn't match package version | BLOCKING | Runtime version reporting broken |

## Bypass Mechanism

Maintainer can bypass with one of:

1. **CLI flag**: `/pr-review <pr> --skip-version-check`
2. **GitHub label**: Add `skip-version-check` label to PR
3. **PR description marker**: Include `[skip-version-check]` in PR body

**When bypassed:**
- Still run validation and report findings
- Mark as `[WAIVED]` instead of `[BLOCKING]`
- Add note: "Version validation bypassed by maintainer"

## Output Format

```markdown
### Version Validation

**Status:** ✅ PASSED | ⚠️ WAIVED | ❌ FAILED

**Version Detected:** 1.2.3 → 1.2.4

**Files Checked:**
- [x] .claude-plugin/marketplace.json: 1.2.4 ✓
- [x] plugins/*/plugin.json: 1.2.4 ✓ (11 plugins)
- [x] plugins/memory-palace/plugin.json: 1.3.0 ✓ (independent cycle)
- [x] CHANGELOG.md: Entry for 1.2.4 ✓
- [x] README.md: References updated ✓

**Blocking Issues (0):**
None - all version files consistent.

---

OR with issues:

### Version Validation

**Status:** ❌ FAILED

**Branch Name:** skills-improvements-1.2.2
**Version Detected:** 1.1.0 → 1.2.1

**Files Checked:**
- [ ] Branch name version: 1.2.2 ≠ Marketplace version: 1.2.1 ❌
- [x] .claude-plugin/marketplace.json: 1.2.1 ✓
- [x] plugins/abstract/plugin.json: 1.2.1 ✓
- [ ] plugins/memory-palace/plugin.json: Marketplace lists 1.2.1 but actual is 1.2.0 ❌
- [x] CHANGELOG.md: Entry for 1.2.1 ✓
- [ ] README.md: Still references 1.1.0 ⚠️

**Blocking Issues (2):**
- [B-VERSION-1] Branch name suggests version 1.2.2, but marketplace/project version is 1.2.1
  - Branch: skills-improvements-1.2.2
  - Expected: Version files should match branch name version
  - Fix: Update version files to 1.2.2 OR rename branch to match 1.2.1
- [B-VERSION-2] Version mismatch: memory-palace
  - Marketplace: 1.2.1
  - Actual: 1.2.0
  - Fix: Update marketplace.json line 52 to "1.2.0"

**In-Scope Issues (1):**
- [S-VERSION-1] README references old version 1.1.0
  - Fix: Update README.md to reference 1.2.1
```

## Integration with PR Review Workflow

This module runs in **Phase 1.5** (after scope establishment, before code analysis):

```
Phase 1: Scope Establishment
Phase 1.5: Version Validation ← NEW
Phase 2: Code Analysis
Phase 3: Synthesis & Validation
Phase 4: GitHub Review Submission
Phase 5: Test Plan Generation
```

**Why Phase 1.5?**
- Version issues are blocking and should be caught early
- Prevents wasting time on detailed code review if basic version hygiene fails
- Provides fast feedback to PR author

## Error Handling

### Missing Version Files
```markdown
⚠️ Version validation skipped: No version files detected in repository.
Consider adding CHANGELOG.md for release tracking.
```

### Multiple Version Schemes
```markdown
ℹ️ Detected multiple version schemes:
- Python package: 2.1.0 (pyproject.toml)
- Frontend: 1.5.0 (package.json)

Validated each independently.
```

### Parse Failures
```bash
if ! jq -e '.metadata.version' .claude-plugin/marketplace.json >/dev/null 2>&1; then
  echo "[B-VERSION] Failed to parse version from marketplace.json - invalid JSON?"
fi
```

## Testing the Module

```bash
# Test version validation manually
Skill(sanctum:pr-review)

# With bypass
/pr-review 42 --skip-version-check

# Dry run to see what would be checked
/pr-review 42 --dry-run
```

## Maintenance Notes

- Update detection patterns when new project types are added
- Keep version file list synchronized with `sanctum:version-updates` skill
- Consider adding support for monorepo version strategies
- May need adjustment for projects using date-based or git-hash versions
