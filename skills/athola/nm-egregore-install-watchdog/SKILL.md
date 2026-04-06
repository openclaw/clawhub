---
name: install-watchdog
description: |
  Install the egregore watchdog daemon using the OS-native scheduler. Creates a launchd plist (macOS) or systemd timer (Linux) that checks every 5 minutes if egregore needs relaunching
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/egregore", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: egregore
---

> **Night Market Skill** — ported from [claude-night-market/egregore](https://github.com/athola/claude-night-market/tree/master/plugins/egregore). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Install Watchdog

## Overview

Installs a persistent daemon that monitors the egregore
process and relaunches it when needed.
The daemon uses the OS-native scheduler (launchd on macOS,
systemd on Linux) to run a watchdog script every 5 minutes.

The watchdog script checks:

- Whether an egregore session is already running.
- Whether the budget is in cooldown.
- Whether there are active work items in the manifest.

If all conditions are met, it launches a new egregore
session.

## When To Use

- After initializing an egregore project (`egregore init`)
  when you want autonomous relaunching.
- When setting up egregore on a new machine.

## When NOT To Use

- On CI/CD runners (use the orchestrator directly).
- When you want manual control over session launches.

## Installation Steps

### 1. Detect the operating system

```bash
OS=$(uname -s)
```

### 2. Run the appropriate installer

**macOS (launchd):**

```bash
bash plugins/egregore/scripts/install_launchd.sh
```

This script creates a plist at
`~/Library/LaunchAgents/com.egregore.watchdog.plist`
that runs the watchdog script every 300 seconds (5 minutes).

**Linux (systemd):**

```bash
bash plugins/egregore/scripts/install_systemd.sh
```

This script creates a systemd timer and service unit at
`~/.config/systemd/user/` that fires every 5 minutes.

### 3. Verify installation

**macOS:**

```bash
launchctl list | grep egregore
```

Expected output: a line containing
`com.egregore.watchdog` with a PID or `-` status.

**Linux:**

```bash
systemctl --user status egregore-watchdog.timer
```

Expected output: `active (waiting)` status.

### 4. Confirm to the user

Report the installation result, the schedule interval, and
the log file location:

- macOS: `~/.egregore/watchdog.log`
- Linux: `journalctl --user -u egregore-watchdog`

## Uninstall Command

To remove the watchdog, run:

```
Skill(egregore:uninstall-watchdog)
```

Or invoke the uninstall skill directly via the command
`/egregore:uninstall-watchdog`.

## Troubleshooting

- **Permission denied on plist**: ensure the script runs
  as the current user, not root.
- **systemd user session not available**: run
  `loginctl enable-linger $USER` to enable user services
  without an active login session.
- **Watchdog not firing**: check the log output and verify
  the scheduler is loaded (`launchctl list` or
  `systemctl --user list-timers`).
