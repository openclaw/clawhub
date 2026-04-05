# Deployment Checklist

## Overview

Final validation checklist before deploying a skill. validates quality, completeness, and effectiveness through systematic verification.

## Pre-Deployment Gates

Skills must pass ALL gates before deployment. No exceptions.

### Gate 1: Empirical Testing Complete

**Status**: [ ] Not Started | [ ] In Progress | [ ] Complete

#### RED Phase Verification

- [ ] 3+ baseline scenarios documented
- [ ] Tests run in fresh Claude instances (no context contamination)
- [ ] Full responses captured verbatim (no editing)
- [ ] Failures categorized and analyzed
- [ ] Patterns identified across scenarios
- [ ] Compliance baseline measured (percentage)

**Evidence Required**: Baseline test documentation in `tests/baseline/`

#### GREEN Phase Verification

- [ ] Same scenarios tested with skill active
- [ ] Tests run in fresh instances (different from baseline)
- [ ] Measurable improvement demonstrated (≥50%)
- [ ] Compliance increase quantified
- [ ] Remaining issues documented
- [ ] Partial improvements explained

**Evidence Required**: With-skill test documentation in `tests/with-skill/`

#### REFACTOR Phase Verification

- [ ] Rationalization scenarios designed
- [ ] Adversarial testing completed
- [ ] Rationalizations documented verbatim
- [ ] Explicit counters added to skill
- [ ] Regression testing passed
- [ ] 3+ consecutive tests with 100% compliance

**Evidence Required**: Rationalization test documentation in `tests/rationalization/`

### Gate 2: Structure and Format

**Status**: [ ] Not Started | [ ] In Progress | [ ] Complete

#### SKILL.md Requirements

- [ ] File named exactly `SKILL.md` (case-sensitive)
- [ ] YAML frontmatter present and valid
- [ ] Required frontmatter fields complete:
  - [ ] `name` (lowercase, hyphens, ≤64 chars)
  - [ ] `description` (third person, ≤1024 chars)
  - [ ] `version` (semver format)
  - [ ] `category` (valid category)
  - [ ] `tags` (relevant keywords)
  - [ ] `estimated_tokens` (realistic)
- [ ] Line count under 500 lines
- [ ] Markdown syntax valid
- [ ] No broken links or references

#### Module Requirements (if applicable)

- [ ] Module files in `modules/` directory
- [ ] Module files 200-400 lines each
- [ ] One level reference depth only
- [ ] All references from SKILL.md exist
- [ ] No circular references
- [ ] Module topics focused and distinct

#### Sandbox Compatibility (Claude Code 2.1.38+)

- [ ] Skill does not require runtime writes to `.claude/skills/` (blocked in sandbox mode)
- [ ] If skill creates/modifies other skills, documented as requiring non-sandbox mode

#### Script Requirements (if applicable)

- [ ] Scripts in `scripts/` directory
- [ ] Execute permissions set correctly
- [ ] Script documentation present
- [ ] Dependencies documented
- [ ] Error handling implemented
- [ ] Test coverage exists

### Gate 3: Description Optimization

**Status**: [ ] Not Started | [ ] In Progress | [ ] Complete

#### Voice and Clarity

- [ ] Third person voice ("Guides...", "Teaches...", "Provides...")
- [ ] NOT first person ("I help...", "We teach...")
- [ ] Active, specific verbs used
- [ ] No marketing language or hyperbole
- [ ] Clear, concrete language (not vague)

#### Discovery Optimization

- [ ] Includes "Use when..." clause
- [ ] 3+ specific use cases listed
- [ ] Key discovery terms included
- [ ] Domain-specific terminology present
- [ ] Length 200-400 characters (optimal)
- [ ] Distinguishes from similar skills

#### Validation Test

- [ ] Passes `skill_validator.py` description checks
- [ ] Discovery tested with sample queries
- [ ] Activation reliable for target scenarios

### Gate 4: Content Quality

**Status**: [ ] Not Started | [ ] In Progress | [ ] Complete

#### Core Content

- [ ] Overview section clear and complete
- [ ] "When to Use" section explicit
- [ ] Quick Start provides minimal example
- [ ] Common tasks identified
- [ ] Module references clear and actionable
- [ ] No orphaned sections

#### Examples

- [ ] At least one complete example in SKILL.md
- [ ] Example shows typical usage
- [ ] Example demonstrates key features
- [ ] Additional examples in modules (if needed)
- [ ] Examples are realistic (not theoretical)

#### Anti-Rationalization

- [ ] Red flags list included
- [ ] Exception table present (if applicable)
- [ ] Commitment statements added (if applicable)
- [ ] Common rationalizations explicitly countered
- [ ] No ambiguous requirements

### Gate 5: Technical Validation

**Status**: [ ] Not Started | [ ] In Progress | [ ] Complete

#### Automated Validation

```bash
# Run skill validator
python scripts/skill_validator.py

# Expected: Exit code 0 (success)
# Acceptable: Exit code 1 (warnings only)
# Must fix: Exit code 2 (errors)
```

Validation results:
- [ ] Exit code 0 or 1
- [ ] No critical errors
- [ ] All warnings reviewed
- [ ] Validation report saved

#### Manual Checks

- [ ] YAML parses correctly
- [ ] All file references valid
- [ ] No dead links in documentation
- [ ] Token estimate verified
- [ ] Dependencies exist and load
- [ ] No syntax errors in examples

### Gate 6: Integration Testing

**Status**: [ ] Not Started | [ ] In Progress | [ ] Complete

#### Isolation Testing

- [ ] Skill loads without errors
- [ ] No conflicts with other skills
- [ ] Dependencies resolve correctly
- [ ] Module loading works
- [ ] Scripts execute successfully

#### Workflow Testing

- [ ] Typical workflow tested end-to-end
- [ ] Edge cases verified
- [ ] Error conditions handled
- [ ] Integration with dependent skills tested
- [ ] No unexpected side effects

#### Cross-Platform Testing (if applicable)

- [ ] Tested on primary platform
- [ ] Path separators correct
- [ ] File permissions appropriate
- [ ] Scripts portable

### Gate 7: Documentation

**Status**: [ ] Not Started | [ ] In Progress | [ ] Complete

#### User-Facing Documentation

- [ ] README.md exists (if plugin-level)
- [ ] Installation instructions clear
- [ ] Usage examples complete
- [ ] Troubleshooting section included
- [ ] Common issues documented

#### Developer Documentation

- [ ] Test results documented
- [ ] Improvement history tracked
- [ ] Known limitations listed
- [ ] Future enhancements noted
- [ ] Maintenance notes added

### Gate 8: Compliance and Standards

**Status**: [ ] Not Started | [ ] In Progress | [ ] Complete

#### Skill Standards

- [ ] Follows modular-skills architecture patterns
- [ ] Adheres to progressive disclosure principles
- [ ] Uses persuasion principles appropriately
- [ ] Implements anti-rationalization techniques
- [ ] Token efficiency optimized

#### Code Quality (for scripts)

- [ ] Type hints present (Python)
- [ ] Error handling detailed
- [ ] Logging implemented
- [ ] Security reviewed
- [ ] No hardcoded secrets

#### Ethical Review

- [ ] Persuasion serves user interests
- [ ] No manipulative language
- [ ] Transparency about intent
- [ ] Appropriate strength calibration
- [ ] User override possible

## Quick Validation Command

```bash
# Run all automated checks
make validate-skill PATH=/path/to/skill/SKILL.md

# Or manually:
python scripts/skill_validator.py --path /path/to/skill/SKILL.md --strict
```

## Validation Script Output

Expected output from `skill_validator.py`:

```
Skill Validation Report
=======================

Skill: skill-name (v1.0.0)
Path: /path/to/skill/SKILL.md

Structure Checks
----------------
OK SKILL.md exists
OK YAML frontmatter valid
OK Required fields present
OK Name format valid
OK Description format valid
OK Line count: 456/500
OK Module references valid

Content Checks
--------------
OK Third person voice
OK "Use when" clause present
OK Discovery terms included
OK Examples present
OK No broken links

Quality Checks
--------------
OK Token estimate reasonable
OK No empty sections
OK Version valid (semver)
! Warning: Description could include more discovery terms

Result: PASS (1 warning)
Exit Code: 1

Recommendation: Fix warnings before deployment (optional)
```

## Deployment Steps

After passing all gates:

### 1. Final Review

```bash
# Review checklist completion
cat deployment-checklist.md

# Verify all gates marked complete
grep "\[x\]" deployment-checklist.md
```

### 2. Version Tag

```bash
# Tag release
git tag -a skill-name-v1.0.0 -m "Release skill-name v1.0.0"

# Push tag
git push origin skill-name-v1.0.0
```

### 3. Documentation Update

```bash
# Update changelog
echo "## v1.0.0 - $(date +%Y-%m-%d)" >> CHANGELOG.md
echo "- Initial release" >> CHANGELOG.md

# Update registry (if applicable)
# Add to skill registry/catalog
```

### 4. Deployment

```bash
# Copy to deployment location
cp -r skill-name ~/.claude/skills/

# Or install via package manager
claude-skills install skill-name

# Verify installation
claude-skills list | grep skill-name
```

### 5. Post-Deployment Verification

```bash
# Test in production environment
# Run smoke tests
# Verify skill activates correctly
# Confirm expected behavior
```

## Rollback Plan

If issues discovered post-deployment:

### Immediate Actions

1. **Document Issue**
   - Exact failure observed
   - Reproduction steps
   - Impact assessment

2. **Rollback Decision**
   - Minor issue: Hot fix acceptable?
   - Major issue: Immediate rollback required?

3. **Execute Rollback** (if needed)
   ```bash
   # Revert to previous version
   git revert skill-name-v1.0.0

   # Or restore previous version
   cp -r skill-name.backup ~/.claude/skills/skill-name
   ```

### Fix and Redeploy

1. Fix issue in development
2. Re-run affected gate checks
3. Update version number
4. Re-deploy with new version

## Success Criteria Summary

**Minimum requirements for deployment:**

1.  **Empirical Testing**: 3+ baseline scenarios, ≥50% improvement, 3+ consecutive 100% compliance tests
2.  **Structure**: Valid YAML, <500 lines, proper file organization
3.  **Description**: Third person, "Use when" clause, 200-400 chars, discovery optimized
4.  **Content**: Clear overview, examples, anti-rationalization, no orphans
5.  **Validation**: Passes `skill_validator.py` with exit code 0 or 1
6.  **Integration**: Loads without errors, no conflicts, workflows tested
7.  **Documentation**: Complete user and developer docs
8.  **Standards**: Follows best practices, ethical review passed

**Any gate failure = DO NOT DEPLOY**

## Post-Deployment Monitoring

### Week 1: Active Monitoring

- [ ] Monitor activation rates
- [ ] Collect user feedback
- [ ] Watch for unexpected behaviors
- [ ] Review error logs
- [ ] Track compliance rates

### Week 2-4: Adjustment Period

- [ ] Analyze usage patterns
- [ ] Identify improvement opportunities
- [ ] Plan updates if needed
- [ ] Document lessons learned

### Month 2+: Maintenance

- [ ] Periodic regression testing
- [ ] Update for new best practices
- [ ] Incorporate user feedback
- [ ] Maintain compatibility

## Continuous Improvement

After deployment, track:

1. **Activation Success Rate**: How often skill activates when it should
2. **Compliance Rate**: How often Claude follows all requirements
3. **User Satisfaction**: Feedback and issue reports
4. **Performance**: Token usage, latency, context efficiency
5. **Maintenance Cost**: Time spent on updates and fixes

Use metrics to guide future improvements.

## Checklist Template

```markdown
# Deployment Checklist: [Skill Name] v[Version]

Date: YYYY-MM-DD
Developer: [Name]

## Gate 1: Empirical Testing
- [ ] RED phase complete
- [ ] GREEN phase complete
- [ ] REFACTOR phase complete

## Gate 2: Structure and Format
- [ ] SKILL.md requirements met
- [ ] Module requirements met (if applicable)
- [ ] Script requirements met (if applicable)

## Gate 3: Description Optimization
- [ ] Voice and clarity verified
- [ ] Discovery optimization complete
- [ ] Validation tests passed

## Gate 4: Content Quality
- [ ] Core content complete
- [ ] Examples included
- [ ] Anti-rationalization implemented

## Gate 5: Technical Validation
- [ ] Automated validation passed
- [ ] Manual checks complete

## Gate 6: Integration Testing
- [ ] Isolation testing passed
- [ ] Workflow testing complete
- [ ] Cross-platform verified (if applicable)

## Gate 7: Documentation
- [ ] User-facing docs complete
- [ ] Developer docs complete

## Gate 8: Compliance and Standards
- [ ] Skill standards met
- [ ] Code quality verified (if applicable)
- [ ] Ethical review passed

## Validation Results
Validator exit code: [0/1/2]
Issues found: [Count]
Critical issues: [Count]

## Deployment Decision
[ ] APPROVED - All gates passed
[ ] APPROVED WITH WARNINGS - Minor issues documented
[ ] REJECTED - Must fix critical issues

Signature: ________________
Date: ________________
```

## Summary

Deployment requires:
- **8 quality gates** all passed
- **Empirical testing** complete with documented results
- **Technical validation** successful (validator exit code 0 or 1)
- **No critical issues** remaining

**Golden rule**: If you're unsure about any gate, that gate has NOT passed. Fix issues before deploying.
