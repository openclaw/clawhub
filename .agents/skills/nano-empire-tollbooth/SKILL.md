---
name: nano-empire-tollbooth
description: Payment rails for AI agents. Route any API call through the tollbooth with automatic x402 payment challenges, HMAC verification, cryptographic proof packs, and credit-based billing.
---

# Nano Empire Tollbooth

Payment rails for autonomous AI agents. Every agent call routes through the tollbooth with automatic x402 payment challenges, HMAC-SHA256 verification, and cryptographic proof packs.

## Features

- **x402 Payment Challenges**: Automatic HTTP 402 responses with signed payment challenges
- **HMAC Verification**: Constant-time signature verification with key rotation support
- **Proof Packs**: Cryptographic receipts for every transaction with verifiable integrity
- **Credit-Based Billing**: Prepaid credits with 80/20 revenue split for skill developers
- **Marketplace Integration**: 6 monetized skills live (AutoSales, TTS, Proxy, Proof, LongCat, x402 Debugger)
- **Multi-Transport**: HTTP, SSE, stdio, WebSocket support

## Quick Start

```bash
pip install nano-empire-guardrails

from nano_empire_guardrails import monetize

@monetize(credits_per_call=1)
def your_skill(text: str) -> str:
    return f"Processed: {text}"
```

## Revenue Model

| Tier | Price | Credits | Per Call |
|------|-------|---------|----------|
| Starter | $10 | 500 | $0.02 |
| Builder | $45 | 2,500 | $0.018 |
| Operator | $150 | 10,000 | $0.015 |

**Developer earns 80%** — Nano Empire takes 20% toll.

## Verification

- Live tollbooth: `http://147.5.105.20:8403/healthz`
- Revenue: $1,000+ CAD, 16+ transactions
- Tests: 132/132 passing (22 security tests)
- Marketplace: 6 skills live

## Architecture

```
Agent Request → x402 Challenge → HMAC Sign → Proof Pack → Revenue
```

Each transaction generates a cryptographically verifiable proof pack with:
- Input hash (SHA-256)
- Output hash (SHA-256)
- HMAC-SHA256 signature
- Timestamp
- Nonce (5-minute TTL)
- Key ID for rotation support

## Integration

Works with any MCP server, FastAPI, FastMCP, or custom HTTP handlers. One decorator adds monetization to any callable.

## Support

- Issues: https://github.com/nanoempireai/tollbooth/issues
- Docs: https://nanoempireai.com
- Email: rob@nanoempire.ai
