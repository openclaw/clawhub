---
name: service-registry
description: |
  Service registry patterns for managing external services, health checks, centralized configuration, and unified execution
version: 1.8.1
triggers:
  - services
  - registry
  - execution
  - health-checks
  - integration
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/leyline", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.quota-management", "night-market.usage-logging"]}}}
source: claude-night-market
source_plugin: leyline
---

> **Night Market Skill** — ported from [claude-night-market/leyline](https://github.com/athola/claude-night-market/tree/master/plugins/leyline). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [When to Use](#when-to-use)
- [Core Concepts](#core-concepts)
- [Service Configuration](#service-configuration)
- [Execution Result](#execution-result)
- [Quick Start](#quick-start)
- [Register Services](#register-services)
- [Execute via Service](#execute-via-service)
- [Health Checks](#health-checks)
- [Service Selection](#service-selection)
- [Auto-Selection](#auto-selection)
- [Failover Pattern](#failover-pattern)
- [Integration Pattern](#integration-pattern)
- [Detailed Resources](#detailed-resources)
- [Exit Criteria](#exit-criteria)


# Service Registry

## Overview

A registry pattern for managing connections to external services. Handles configuration, health checking, and execution across multiple service integrations.

## When To Use

- Managing multiple external services.
- Need consistent execution interface.
- Want health monitoring across services.
- Building service failover logic.

## When NOT To Use

- Single service integration without registry needs

## Core Concepts

### Service Configuration

```python
@dataclass
class ServiceConfig:
    name: str
    command: str
    auth_method: str  # "api_key", "oauth", "token"
    auth_env_var: str
    quota_limits: dict
    models: list[str] = field(default_factory=list)
```
**Verification:** Run the command with `--help` flag to verify availability.

### Execution Result

```python
@dataclass
class ExecutionResult:
    success: bool
    stdout: str
    stderr: str
    exit_code: int
    duration: float
    tokens_used: int
```
**Verification:** Run the command with `--help` flag to verify availability.

## Quick Start

### Register Services
```python
from leyline.service_registry import ServiceRegistry

registry = ServiceRegistry()

registry.register("gemini", ServiceConfig(
    name="gemini",
    command="gemini",
    auth_method="api_key",
    auth_env_var="GEMINI_API_KEY",
    quota_limits={"rpm": 60, "daily": 1000}
))
```
**Verification:** Run the command with `--help` flag to verify availability.

### Execute via Service
```python
result = registry.execute(
    service="gemini",
    prompt="Analyze this code",
    files=["src/main.py"],
    model="gemini-2.5-pro"
)

if result.success:
    print(result.stdout)
```
**Verification:** Run the command with `--help` flag to verify availability.

### Health Checks
```python
# Check single service
status = registry.health_check("gemini")

# Check all services
all_status = registry.health_check_all()
for service, healthy in all_status.items():
    print(f"{service}: {'OK' if healthy else 'FAILED'}")
```
**Verification:** Run the command with `--help` flag to verify availability.

## Service Selection

### Auto-Selection
```python
# Select best service for task
service = registry.select_service(
    requirements={
        "large_context": True,
        "fast_response": False
    }
)
```
**Verification:** Run the command with `--help` flag to verify availability.

### Failover Pattern
```python
def execute_with_failover(prompt: str, files: list) -> ExecutionResult:
    for service in registry.get_healthy_services():
        result = registry.execute(service, prompt, files)
        if result.success:
            return result
    raise AllServicesFailedError()
```
**Verification:** Run the command with `--help` flag to verify availability.

## Integration Pattern

```yaml
# In your skill's frontmatter
dependencies: [leyline:service-registry]
```
**Verification:** Run the command with `--help` flag to verify availability.

## Detailed Resources

- **Service Config**: See `modules/service-config.md` for configuration options.
- **Execution Patterns**: See `modules/execution-patterns.md` for advanced usage.

## Exit Criteria

- Services registered with configuration.
- Health checks passing.
- Execution results properly handled.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
