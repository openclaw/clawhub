---
name: rule-catalog
description: Browse the rule catalog and guide installation
version: 1.8.1
triggers:
  - hookify
  - rules
  - catalog
  - install
  - templates
  - looking for
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/hookify", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: hookify
---

> **Night Market Skill** — ported from [claude-night-market/hookify](https://github.com/athola/claude-night-market/tree/master/plugins/hookify). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## When To Use

- Browsing available hookify rules by category
- Installing standard pre-built rules into a project
- Looking for ready-made rules before writing custom ones

## When NOT To Use

- Writing custom rules from scratch — use `hookify:writing-rules` instead
- Debugging or modifying existing installed rules
- Converting Python SDK hooks — use `hookify:from-hook` instead

## Table of Contents

- [Quick Install](#quick-install)
- [Available Rules](#available-rules)
- [git/ - Git Safety](#git----git-safety)
- [python/ - Python Quality](#python----python-quality)
- [security/ - Security Gates](#security----security-gates)
- [workflow/ - Workflow Enforcement](#workflow----workflow-enforcement)
- [performance/ - Resource Management](#performance----resource-management)
- [Installation Instructions](#installation-instructions)
- [Method 1: Claude-Assisted (Recommended)](#method-1:-claude-assisted-(recommended))
- [Method 2: Python Script](#method-2:-python-script)
- [Method 3: Manual Copy](#method-3:-manual-copy)
- [Rule File Locations](#rule-file-locations)
- [Customizing Rules](#customizing-rules)
- [Creating Pull Requests for New Rules](#creating-pull-requests-for-new-rules)
- [Related](#related)


# Hookify Rule Catalog

Pre-built rules for common scenarios. Install directly or use as templates.

## Quick Install

```bash
# Install a specific rule
Skill(hookify:rule-catalog) then install git:block-force-push

# Or use the Python installer for bulk operations
python3 plugins/hookify/scripts/install_rule.py git:block-force-push
python3 plugins/hookify/scripts/install_rule.py --category git
python3 plugins/hookify/scripts/install_rule.py --all
```
**Verification:** Run `python --version` to verify Python environment.

## Available Rules

### git/ - Git Safety
| Rule | Action | Default | Description |
|------|--------|---------|-------------|
| `block-force-push` | block | enabled | Prevent force push to main/master |
| `block-destructive-git` | block | enabled | Block reset --hard, checkout -- ., clean -fd, etc. |
| `warn-risky-git` | warn | enabled | Warn about rebase -i, soft reset, etc. |
| `warn-large-commits` | warn | enabled | Warn about large binary files |

### python/ - Python Quality
| Rule | Action | Default | Description |
|------|--------|---------|-------------|
| `block-dynamic-code` | block | enabled | Block dangerous dynamic code execution |
| `warn-print-statements` | warn | enabled | Encourage logging over print() |

### security/ - Security Gates
| Rule | Action | Default | Description |
|------|--------|---------|-------------|
| `require-security-review` | block | enabled | Require review for auth code |

### workflow/ - Workflow Enforcement
| Rule | Action | Default | Description |
|------|--------|---------|-------------|
| `enforce-scope-guard` | warn | enabled | Anti-overengineering (imbue) |
| `require-spec-before-code` | block | disabled | Spec-first development |

### performance/ - Resource Management
| Rule | Action | Default | Description |
|------|--------|---------|-------------|
| `warn-large-file-ops` | warn | enabled | Watch large file writes |

## Installation Instructions

### Method 1: Claude-Assisted (Recommended)

When you invoke this skill, tell Claude which rule(s) to install:

```
**Verification:** Run `git status` to confirm working tree state.
Install git:block-force-push
```
**Verification:** Run the command with `--help` flag to verify availability.

Claude will:
1. Read the rule from `skills/rule-catalog/rules/git/block-force-push.md`
2. Write it to `.claude/hookify.block-force-push.local.md`
3. Confirm installation

### Method 2: Python Script

For bulk operations or automation:

```bash
# Install single rule
python3 plugins/hookify/scripts/install_rule.py git:block-force-push

# Install all rules in category
python3 plugins/hookify/scripts/install_rule.py --category python

# Install all rules
python3 plugins/hookify/scripts/install_rule.py --all

# List available rules
python3 plugins/hookify/scripts/install_rule.py --list

# Install to custom directory
python3 plugins/hookify/scripts/install_rule.py git:block-force-push --target /path/to/.claude
```
**Verification:** Run the command with `--help` flag to verify availability.

### Method 3: Manual Copy

1. Find rule in `plugins/hookify/skills/rule-catalog/rules/<category>/<rule>.md`
2. Copy to `.claude/hookify.<rule-name>.local.md`
3. Edit `enabled: true/false` as needed

## Rule File Locations

Rules are stored relative to this skill:

```
**Verification:** Run the command with `--help` flag to verify availability.
skills/rule-catalog/
├── SKILL.md (this file)
└── rules/
    ├── git/
    │   ├── block-force-push.md
    │   ├── block-destructive-git.md
    │   ├── warn-risky-git.md
    │   └── warn-large-commits.md
    ├── python/
    │   ├── block-dynamic-code.md
    │   └── warn-print-statements.md
    ├── security/
    │   └── require-security-review.md
    ├── workflow/
    │   ├── enforce-scope-guard.md
    │   └── require-spec-before-code.md
    └── performance/
        └── warn-large-file-ops.md
```
**Verification:** Run the command with `--help` flag to verify availability.

## Customizing Rules

After installation, edit the rule in `.claude/`:

```yaml
# Change action from warn to block
action: block

# Disable temporarily
enabled: false

# Modify pattern
pattern: your-custom-pattern
```
**Verification:** Run the command with `--help` flag to verify availability.

## Creating Pull Requests for New Rules

To add rules to the catalog:

1. Create rule file in appropriate category
2. Follow naming convention: `kebab-case.md`
3. Include detailed message with alternatives
4. Test thoroughly before submitting
5. Update this SKILL.md catalog table

## Related

- `Skill(hookify:writing-rules)` - Create custom rules
- `/hookify:list` - Show installed rules
- `/hookify:configure` - Manage installed rules
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
