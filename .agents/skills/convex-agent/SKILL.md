---
name: convex-agent
description: "Add an AI agent / RAG backend (@convex-dev/agent) to the Convex app."
---

<!-- GENERATED from convex-agents content/capabilities/agent.json — do not edit by hand. -->

# Add an AI agent / RAG backend

Install @convex-dev/agent for durable threads, message history, tool-calls, and vector search/RAG — the backend for an in-app AI agent.

## Workflow

1. Install @convex-dev/agent + add to convex.config.ts.
2. Define the agent (model, tools, instructions); store the LLM key via the `env` micro power.
3. Create threads + stream messages; persist history in Convex.
4. For RAG: embed docs into a vector index and retrieve in the tool.

## Rules

- Keep the LLM API key in Convex env (use the `env` micro power), never client-side.
- Run model calls in actions ('use node' if the SDK needs it).
- Persist threads/messages in Convex for durability + reactivity.
