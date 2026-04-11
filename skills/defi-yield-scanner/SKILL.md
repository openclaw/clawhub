---
name: DeFi Yield Scanner
version: 1.0.0
summary: Real-time DeFi yield scanning, token risk analysis, and wallet exposure checking
tags: [defi, crypto, yield, token, base, ethereum, analysis, mcp]
---

# DeFi Yield Scanner

MCP server providing real-time DeFi analytics for AI agents.

## Tools

### scan_token_risk
Analyze any token by contract address. Returns risk score (0-100), liquidity depth, volume analysis.

### scan_defi_yields
Top yield opportunities on Base chain from DeFiLlama. APY, TVL, pool data from Aave, Morpho, Compound, Moonwell.

### check_wallet_exposure
Portfolio risk analysis across DeFi protocols.

## Install

```bash
npx defi-yield-scanner-mcp
```

## Data Sources

- DexScreener (real-time token prices)
- DeFiLlama (yield data from 500+ protocols)

## npm

https://www.npmjs.com/package/defi-yield-scanner-mcp
