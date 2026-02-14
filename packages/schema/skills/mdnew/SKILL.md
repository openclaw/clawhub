---
name: mdnew
description: Fetch clean, agent-optimized Markdown from any URL using the markdown.new service. Use when web_fetch or browser fails to provide clean content, or when you need a token-efficient version of a web page for deep analysis.
---

# mdnew

Fetch clean Markdown from any URL using the `markdown.new` three-tier conversion pipeline (Header Negotiation -> Workers AI -> Browser Rendering).

## Usage

Run the script with a target URL:

```bash
python3 scripts/mdnew.py <url>
```

## Why use mdnew?

1. **Token Efficiency**: Reduces content size by up to 80% compared to raw HTML.
2. **Clean Data**: Strips boilerplate, ads, and nav menus, leaving only core content.
3. **JS Execution**: Automatically handles JS-heavy pages via Cloudflare Browser Rendering fallback.
4. **Agent-First**: Includes `x-markdown-tokens` tracking to help manage context windows.
