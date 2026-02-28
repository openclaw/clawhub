---
name: owlclaw-for-openclaw
description: Connect OpenClaw agents to OwlClaw MCP for governance and durable tasks.
metadata:
  author: owlclaw
  version: "0.1.0"
  tags:
    - openclaw
    - mcp
    - governance
tools:
  governance_budget_status:
    description: Query current budget usage for one agent.
    parameters:
      type: object
      properties:
        tenant_id:
          type: string
        agent_id:
          type: string
      required: [tenant_id, agent_id]
  task_create:
    description: Create one durable background task.
    parameters:
      type: object
      properties:
        workflow_name:
          type: string
      required: [workflow_name]
owlclaw:
  binding:
    type: mcp
    endpoint: ${OWLCLAW_MCP_ENDPOINT}
---

# OwlClaw for OpenClaw

Use this package to add OwlClaw governance and durable task capabilities into OpenClaw.

## Installation

1. Install the package in ClawHub.
2. Set `OWLCLAW_MCP_ENDPOINT` to your OwlClaw MCP endpoint.
3. Start your OpenClaw agent and call tools.

## Included capabilities

- Governance: budget, audit, and rate-limit visibility.
- Persistent tasks: create, query, and cancel durable jobs.
- Business connectivity: generated MCP tools from OpenAPI via `owlclaw migrate`.
