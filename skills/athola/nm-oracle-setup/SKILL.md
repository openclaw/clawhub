---
name: setup
description: Provision the oracle inference daemon with Python 3.11+ and onnxruntime via uv
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/oracle", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: oracle
---

> **Night Market Skill** — ported from [claude-night-market/oracle](https://github.com/athola/claude-night-market/tree/master/plugins/oracle). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Oracle Setup

Provision the ML inference environment.

## What This Does

1. Creates a Python 3.11+ virtual environment using uv
2. Installs onnxruntime into the venv
3. Verifies the installation

## Prerequisites

- uv must be installed
- Internet connection for initial download

## Steps

1. Run provisioning:

```bash
cd plugins/oracle && uv run python -c "
from oracle.provision import provision_venv, get_venv_path
result = provision_venv(get_venv_path())
print(result.message)
"
```

2. Report result to the user.
3. If successful, tell the user the daemon will start on next session.
4. If failed, show the error and suggest checking uv and network.
