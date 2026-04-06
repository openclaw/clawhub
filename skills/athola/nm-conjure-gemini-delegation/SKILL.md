---
name: gemini-delegation
description: Gemini CLI delegation workflow implementing delegation-core for Google's
version: 1.8.1
triggers:
  - gemini
  - cli
  - delegation
  - google
  - large-context
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/conjure", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.delegation-core"]}}}
source: claude-night-market
source_plugin: conjure
---

> **Night Market Skill** — ported from [claude-night-market/conjure](https://github.com/athola/claude-night-market/tree/master/plugins/conjure). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [When to Use](#when-to-use)
- [Prerequisites](#prerequisites)
- [Delegation Flow](#delegation-flow)
- [Quick Start](#quick-start)
- [Basic Command](#basic-command)
- [Save Output](#save-output)
- [Shared Patterns](#shared-patterns)
- [Gemini-Specific Details](#gemini-specific-details)
- [Exit Criteria](#exit-criteria)


# Gemini CLI Delegation

## Overview

This skill implements `conjure:delegation-core` for the Gemini CLI. It provides Gemini-specific authentication, quota management, and command construction using shared patterns.

## When To Use
- After `Skill(conjure:delegation-core)` determines Gemini is suitable
- When you need Gemini's large context window (1M+ tokens)
- For batch processing, summarization, or pattern extraction tasks
- If the `gemini` CLI is installed and authenticated

## When NOT To Use

- Deciding which model
  to use (use delegation-core first)
- Gemini CLI not installed
- Deciding which model
  to use (use delegation-core first)
- Gemini CLI not installed

## Prerequisites

**Installation:**
```bash
# Verify installation
gemini --version

# Check authentication
gemini auth status

# Login if needed
gemini auth login

# Or set API key
export GEMINI_API_KEY="your-key"
```
**Verification:** Run the command with `--help` flag to verify availability.

## Delegation Flow

Implements standard delegation-core flow with Gemini specifics:

1. `gemini-delegation:auth-verified` - Verify Gemini authentication
2. `gemini-delegation:quota-checked` - Check Gemini API quota
3. `gemini-delegation:command-executed` - Execute via Gemini CLI
4. `gemini-delegation:usage-logged` - Log Gemini API usage

## Quick Start

### Basic Command
```bash
# File analysis
gemini -p "@path/to/file Analyze this code"

# Multiple files
gemini -p "@src/**/*.py Summarize these files"

# With specific model
gemini --model gemini-2.5-pro-exp -p "..."

# JSON output
gemini --output-format json -p "..."
```
**Verification:** Run the command with `--help` flag to verify availability.

### Save Output
```bash
gemini -p "..." > delegations/gemini/$(date +%Y%m%d_%H%M%S).md
```
**Verification:** Run the command with `--help` flag to verify availability.

## Shared Patterns

This skill uses shared modules from delegation-core:
- **Authentication**: See `delegation-core/../../leyline/skills/authentication-patterns/SKILL.md`
- **Quota Management**: See `delegation-core/../../leyline/skills/quota-management/SKILL.md`
- **Usage Logging**: See `delegation-core/../../leyline/skills/usage-logging/SKILL.md`
- **Error Handling**: See `delegation-core/../../leyline/skills/error-patterns/SKILL.md`

## Gemini-Specific Details

For Gemini-specific models, CLI options, cost reference, and troubleshooting, see `modules/gemini-specifics.md`.

## Exit Criteria
- Authentication confirmed working
- Quota checked and sufficient
- Command executed successfully
- Usage logged for tracking
