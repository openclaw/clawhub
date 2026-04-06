---
name: uninstall-watchdog
description: |
  Remove the egregore watchdog daemon and clean up all associated files (plist/unit, pidfile, watchdog log)
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/egregore", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: egregore
---

> **Night Market Skill** — ported from [claude-night-market/egregore](https://github.com/athola/claude-night-market/tree/master/plugins/egregore). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Uninstall Watchdog

## Overview

Removes the egregore watchdog daemon and cleans up all files
created by the install-watchdog skill.
After uninstalling, egregore sessions will no longer be
relaunched automatically.

## When To Use

- When you no longer want autonomous relaunching.
- Before removing the egregore plugin from a project.
- When switching from daemon mode to manual invocation.

## When NOT To Use

- When the watchdog was never installed (check first with
  the verify commands below).

## Uninstall Steps

### 1. Detect the operating system

```bash
OS=$(uname -s)
```

### 2. Stop and remove the service

**macOS (launchd):**

```bash
PLIST=~/Library/LaunchAgents/com.egregore.watchdog.plist

# Unload the agent (stops it if running)
launchctl unload "$PLIST" 2>/dev/null

# Remove the plist file
rm -f "$PLIST"
```

**Linux (systemd):**

```bash
# Stop and disable the timer and service
systemctl --user stop egregore-watchdog.timer 2>/dev/null
systemctl --user disable egregore-watchdog.timer 2>/dev/null

# Remove unit files
rm -f ~/.config/systemd/user/egregore-watchdog.timer
rm -f ~/.config/systemd/user/egregore-watchdog.service

# Reload systemd to pick up the removal
systemctl --user daemon-reload
```

### 3. Clean up associated files

```bash
# Remove pidfile if present
rm -f ~/.egregore/watchdog.pid

# Remove watchdog log
rm -f ~/.egregore/watchdog.log
```

### 4. Confirm removal

**macOS:**

```bash
launchctl list | grep egregore
# Should produce no output
```

**Linux:**

```bash
systemctl --user list-timers | grep egregore
# Should produce no output
```

Report to the user that the watchdog has been removed and
automatic relaunching is disabled.

## Files Removed

| File | Platform | Purpose |
|------|----------|---------|
| `~/Library/LaunchAgents/com.egregore.watchdog.plist` | macOS | launchd agent definition |
| `~/.config/systemd/user/egregore-watchdog.timer` | Linux | systemd timer unit |
| `~/.config/systemd/user/egregore-watchdog.service` | Linux | systemd service unit |
| `~/.egregore/watchdog.pid` | both | PID of last watchdog run |
| `~/.egregore/watchdog.log` | macOS | watchdog output log |
