# Hook Scope Selection Guide

Detailed decision framework for choosing where to place hooks: plugin, project, or global scope.

## Important: Auto-Loading Behavior

> **`hooks/hooks.json` is automatically loaded** by Claude Code when the plugin is enabled.
> Do NOT add `"hooks": "./hooks/hooks.json"` to your `plugin.json` - this causes duplicate load errors.
> The `hooks` field in `plugin.json` is only needed for **additional** hook files beyond the standard `hooks/hooks.json`.

**Correct** (hooks/hooks.json auto-loads):
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "license": "MIT"
}
```

**Incorrect** (causes duplicate hook error):
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "license": "MIT",
  "hooks": "./hooks/hooks.json"
}
```

## The Three Scopes

| Scope | Location | Audience | Version Controlled | Persistence |
|-------|----------|----------|-------------------|-------------|
| **Plugin** | `<plugin-root>/hooks/hooks.json` | Plugin users | Yes (with plugin) | When plugin enabled |
| **Project** | `.claude/settings.json` | Team members | Yes (in repo) | Per project |
| **Global** | `~/.claude/settings.json` | Only you | Never | All sessions |

## Decision Framework

### Three Key Questions

```
Question 1: Who needs this hook?
├─ Only plugin users → Plugin hooks
├─ All team members on this project → Project hooks
└─ Only me, everywhere → Global hooks

Question 2: Should this be version controlled?
├─ Yes, as part of distributable plugin → Plugin hooks
├─ Yes, shared with team in repo → Project hooks
└─ No, keep private → Global hooks

Question 3: What's the persistence requirement?
├─ Only when my plugin is active → Plugin hooks
├─ Always in this specific project → Project hooks
└─ Always, in every project → Global hooks
```

### Decision Flowchart

```
Is this hook part of a plugin's core functionality?
├─ YES → Plugin hooks (hooks/hooks.json in plugin)
└─ NO ↓

Should all team members on this project have this hook?
├─ YES → Project hooks (.claude/settings.json)
└─ NO ↓

Should this hook apply to all my Claude sessions?
├─ YES → Global hooks (~/.claude/settings.json)
└─ NO → Reconsider if you need a hook at all
```

## Plugin Hooks

### When to Use

The hook is **intrinsic to your plugin's functionality** and should automatically activate when users enable your plugin.

**Perfect for:**
- Validation specific to your plugin's domain (e.g., YAML syntax for YAML plugin)
- Auto-formatting that's part of your plugin's features
- Logging operations specific to plugin functionality
- Integration with plugin-specific tools or services

### Location

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json
├── hooks/
│   └── hooks.json          ← Plugin hooks here
└── skills/
    └── my-skill/
        └── SKILL.md
```

### Configuration

**JSON Format** (`hooks/hooks.json`):

```json
{
  "PreToolUse": [
    {
      "matcher": "Read",
      "hooks": [{
        "type": "command",
        "command": "echo 'Plugin reading: $CLAUDE_TOOL_INPUT' >> ${CLAUDE_PLUGIN_ROOT}/log.txt"
      }]
    }
  ]
}
```

**Key Features:**
- Use `${CLAUDE_PLUGIN_ROOT}` for plugin-relative paths
- Automatically merges when plugin is enabled
- Deactivates when plugin is disabled
- Distributed with plugin code

### Examples

**YAML Validation Plugin**:
```json
{
  "PreToolUse": [
    {
      "matcher": "Edit",
      "hooks": [{
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/scripts/validate-yaml.sh $CLAUDE_TOOL_INPUT"
      }]
    }
  ]
}
```

> **Note**: Use string matchers (`"Edit"`) per Claude Code SDK. Filter by file pattern in hook script.

**Code Formatter Plugin**:
```json
{
  "PostToolUse": [
    {
      "matcher": "Edit",
      "hooks": [{
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format-code.py"
      }]
    }
  ]
}
```

## Project Hooks

### When to Use

The hook should apply to **all team members** working on this specific project.

**Perfect for:**
- Enforcing team-wide coding conventions
- Protecting project-specific resources (e.g., production configs)
- Requiring tests before commits
- Project-specific security policies
- Team workflow requirements

### Location

```
my-project/
├── .claude/
│   └── settings.json       ← Project hooks here
├── .git/
├── src/
└── README.md
```

### Configuration

**JSON Format** (`.claude/settings.json`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "if [[ \"$CLAUDE_TOOL_INPUT\" == *\"production\"* ]]; then echo 'BLOCKED: Production access requires approval'; exit 1; fi"
        }]
      }
    ]
  }
}
```

**Key Features:**
- Committed to version control
- Shared across all team members
- Changes visible in PRs (governance trail)
- Project-specific, not personal

### Examples

**Block Production Edits**:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit",
        "hooks": [{
          "type": "command",
          "command": "if [[ \"$CLAUDE_TOOL_INPUT\" == */production/* ]]; then echo 'ERROR: Cannot edit production configs without approval'; exit 1; fi"
        }]
      }
    ]
  }
}
```

**Require Tests Before Completion**:
```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [{
          "type": "command",
          "command": ".claude/hooks/check-tests-run.sh"
        }]
      }
    ]
  }
}
```

**Project Convention Enforcement**:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [{
          "type": "command",
          "command": ".claude/hooks/validate-naming-convention.py"
        }]
      }
    ]
  }
}
```

## Global Hooks

### When to Use

The hook should apply to **all your Claude sessions** across all projects.

**Perfect for:**
- Personal workflow preferences
- Cross-project audit logging
- Organization-wide compliance you want everywhere
- Development environment preferences
- Private rules that shouldn't be shared

### Location

```
~/.claude/
├── settings.json           ← Global hooks here
├── audit.log
└── projects/
```

### Configuration

**JSON Format** (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [{
          "type": "command",
          "command": "echo \"$(date): $CLAUDE_TOOL_NAME\" >> ~/.claude/audit.log"
        }]
      }
    ]
  }
}
```

**Key Features:**
- Never committed to any repo
- Applies to ALL Claude Code sessions
- Personal to your user account
- Survives across projects

### Examples

**Personal Audit Logging**:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [{
          "type": "command",
          "command": "echo \"$(date '+%Y-%m-%d %H:%M:%S') - $CLAUDE_TOOL_NAME\" >> ~/.claude/audit.log"
        }]
      }
    ]
  }
}
```

**Cross-Project Safety**:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "~/.claude/hooks/global-safety-check.sh"
        }]
      }
    ]
  }
}
```

**Development Environment Setup**:
```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [{
          "type": "command",
          "command": "~/.claude/hooks/inject-dev-context.sh"
        }]
      }
    ]
  }
}
```

## Loading Order & Precedence

### Hook Execution Priority

Claude Code loads settings in this priority (highest first):

1. **Enterprise policies** (organization-managed)
2. **Command-line arguments** (`claude --flag`)
3. **Local project settings** (`.claude/settings.local.json` - not committed)
4. **Shared project settings** (`.claude/settings.json` - committed)
5. **User settings** (`~/.claude/settings.json`)

### Multiple Matching Hooks

When multiple hooks from different scopes match the same event, **all matching hooks execute in parallel**.

**Example:**
```
Event: PreToolUse (Bash)

Global hook:  Logs to ~/.claude/audit.log
Project hook: Checks production access
Plugin hook:  Validates command syntax

All three execute in parallel
```

## Scope Comparison Matrix

| Criterion | Plugin | Project | Global |
|-----------|--------|---------|--------|
| **Distribution** | With plugin | In repo | Personal only |
| **Activation** | When plugin enabled | Always in project | Always everywhere |
| **Audience** | Plugin users | Project team | Individual user |
| **Version Control** | Plugin repo | Project repo | Never |
| **Governance** | Plugin maintainer | Team consensus | Personal choice |
| **Security Review** | Plugin installation | PR review | Self-review |
| **Scope** | Plugin operations | Project files | All sessions |

## Common Patterns by Scope

### Plugin Hook Patterns

**Validation**: Check files match plugin's expected format
```json
{
  "PreToolUse": [{
    "matcher": "Edit",
    "hooks": [{"type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/validate.sh"}]
  }]
}
```

> **Note**: Use string matchers. Filter by file pattern inside the hook script.

**Auto-completion**: Suggest plugin-specific completions
```json
{
  "PostToolUse": [{
    "matcher": "Read",
    "hooks": [{"type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/suggest-completions.py"}]
  }]
}
```

### Project Hook Patterns

**Protection**: Block dangerous operations on sensitive paths
```json
{
  "PreToolUse": [{
    "matcher": "Edit",
    "hooks": [{
      "type": "command",
      "command": "if [[ \"$CLAUDE_TOOL_INPUT\" == */production/* ]]; then exit 1; fi"
    }]
  }]
}
```

**Enforcement**: Require tests, linting, or builds
```json
{
  "Stop": [{
    "hooks": [{
      "type": "command",
      "command": ".claude/hooks/check-all-tests-passed.sh"
    }]
  }]
}
```

### Global Hook Patterns

**Auditing**: Log all operations for personal review
```json
{
  "PostToolUse": [{
    "hooks": [{
      "type": "command",
      "command": "echo \"$CLAUDE_TOOL_NAME: $CLAUDE_TOOL_INPUT\" >> ~/.claude/audit.log"
    }]
  }]
}
```

**Safety**: Universal dangerous command detection
```json
{
  "PreToolUse": [{
    "matcher": "Bash",
    "hooks": [{
      "type": "command",
      "command": "~/.claude/hooks/safety-check.sh"
    }]
  }]
}
```

## Security Considerations

### Plugin Hooks
- **Security Review**: Audited during plugin installation
- **User Consent**: Users enable plugin knowing hooks will run
- **Scope Limitation**: Limited to plugin's stated purpose
- **Transparency**: Hooks visible in plugin source

### Project Hooks
- **Team Visibility**: All team members see hook definitions
- **PR Review**: Changes reviewed in pull requests
- **Consensus**: Should reflect team agreement
- **Documentation**: Document purpose in repo

### Global Hooks
- **Personal Risk**: Execute with your credentials everywhere
- **Unexpected Effects**: Can affect all projects
- **Review Carefully**: Test thoroughly before adding
- **Keep Private**: Never commit to any repo

## Migration Patterns

### Plugin → Project

When a plugin hook should become project-specific:

```bash
# Copy from plugin
cp plugins/my-plugin/hooks/hooks.json .claude/hooks/

# Customize for project
# Edit .claude/hooks/hooks.json to remove plugin-specific logic
```

### Project → Global

When a project hook should apply to all your projects:

```bash
# Extract to global hooks
cat .claude/settings.json | jq '.hooks' >> ~/.claude/settings.json

# Remove from project
# Remove hook from .claude/settings.json
```

### Global → Plugin

When your personal hook would benefit all plugin users:

```bash
# Create plugin hooks directory
mkdir -p plugins/my-plugin/hooks/

# Move hook to plugin
# Copy hook logic to plugins/my-plugin/hooks/hooks.json

# Update paths to use ${CLAUDE_PLUGIN_ROOT}
```

## Troubleshooting Scope Issues

### Hook Not Executing

**Check scope activation:**
```bash
# Verify plugin is enabled
claude plugins list

# Check project hooks exist
cat .claude/settings.json

# Verify global hooks exist
cat ~/.claude/settings.json
```

### Hook Executing Unexpectedly

**Check all scopes:**
```bash
# Check which hooks are active
claude hooks list

# Disable plugin temporarily
claude plugins disable my-plugin

# Remove project hook
# Edit .claude/settings.json
```

### Conflicting Hooks

**Identify source:**
```bash
# Show all active hooks
claude hooks list --verbose

# Check precedence order
# Global → Project → Plugin
```

## Best Practices

### Plugin Hooks
1. Use plugin-relative paths (`${CLAUDE_PLUGIN_ROOT}`)
2. Document hooks in plugin README
3. Make hooks optional when possible
4. Test with plugin enabled/disabled

### Project Hooks
1. Document purpose in README or HOOKS.md
2. Review in PRs like other code changes
3. Keep focused on project-specific needs
4. Avoid personal preferences

### Global Hooks
1. Test thoroughly before deploying
2. Document in personal notes
3. Review periodically for relevance
4. Consider security implications

## Related Modules

- **hook-types.md**: Event types and signatures
- **sdk-callbacks.md**: Python SDK implementation
- **security-patterns.md**: Security best practices
- **testing-hooks.md**: Testing strategies per scope
