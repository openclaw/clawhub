---
name: air-sdk
description: Collective web intelligence for browser agents. Discover site capabilities, get CSS selectors, extract structured data, and report outcomes. When one agent learns how to use a website, every agent benefits.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - AIR_API_KEY
      bins:
        - npx
    primaryEnv: AIR_API_KEY
    emoji: "\U0001F310"
    homepage: https://github.com/ArcedeDev/air-sdk
---

# AIR SDK — Collective Web Intelligence

You have 4 MCP tools from AIR SDK. They give you shared knowledge about websites — what actions are possible, which CSS selectors work, and what other agents have already figured out.

## When to use these tools

- User asks you to do something on a website (search, buy, extract data, compare prices)
- User asks what's possible on a site
- User asks you to extract or scrape data from a URL
- You need to interact with a website and want to know the correct selectors before navigating

## Workflow: browse, execute, act, report

Always follow this order:

### Step 1: Browse capabilities

Before navigating to any site, check what's known about it:

```
Tool: browse_capabilities
Input: { "domain": "amazon.com" }
```

This returns capabilities (search, purchase, filter, etc.) with confidence scores and available macros.

### Step 2: Execute a capability

Get the specific execution plan with CSS selectors:

```
Tool: execute_capability
Input: { "domain": "amazon.com", "capability": "search_products", "parameters": { "query": "wireless headphones" } }
```

This returns step-by-step instructions: which URL to visit, which selectors to click/fill, in what order.

### Step 3: Act in the browser

Use the CSS selectors from Step 2 to perform the actions. The selectors have been verified by other agents.

### Step 4: Report what happened

Always report the outcome. This is how the network learns:

```
Tool: report_outcome
Input: {
  "domain": "amazon.com",
  "capability": "search_products",
  "success": true,
  "steps": [
    { "action": "click", "selector": "input#twotabsearchtextbox", "success": true },
    { "action": "fill", "selector": "input#twotabsearchtextbox", "value": "wireless headphones", "success": true },
    { "action": "click", "selector": "input#nav-search-submit-button", "success": true }
  ]
}
```

You MUST include the actual CSS selectors you used. Reports without selectors are discarded.

## Extracting data

To extract structured data from any URL without browser automation:

```
Tool: extract_url
Input: { "url": "https://github.com/ArcedeDev/air-sdk" }
```

Returns title, description, structured content, JSON-LD, and metadata.

## Setup

The AIR SDK MCP server must be configured in your OpenClaw config. Run:

```bash
npx @arcede/air-sdk install-skill
```

This auto-detects OpenClaw and writes the MCP config. Or manually add to `~/.openclaw/openclaw.json`:

```json
{
  "mcpServers": {
    "air-sdk": {
      "command": "air-sdk",
      "args": ["--mcp"],
      "env": { "AIR_API_KEY": "your_key_here" }
    }
  }
}
```

Get a free API key (1,000 executions/month, no credit card): https://agentinternetruntime.com/extract/dashboard/sdk

## Important notes

- This is an early research preview. The capability index is growing but has gaps.
- Some websites block automated browsing. If a site blocks you, report it anyway — the failure data is valuable.
- Privacy: input values, cookies, and PII are never sent. Only anonymized selector and outcome data.
