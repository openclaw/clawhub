---
name: money-reactor
description: |
  Fetch the live feed of funded crypto bounties (Base USDC, escrow-backed + GitHub radar)
  and screen any GitHub repo for honeypot risk before working it. Pay per call via x402
  (USDC on Base) - no signup, no API keys. Free demo and health endpoints included.
  Use when: "find funded bounties", "is this repo a honeypot?", "screen a bounty repo",
  "crypto bounty radar", "trust score for repo".
---

# Money Reactor - funded bounty radar + honeypot scoring (x402)

Live x402 micro-APIs for agents. Pricing: full bounty feed $0.01/call, honeypot score $0.002/call,
one-line verdict $0.001/call. USDC on Base via x402 (HTTP 402). No signup - payments settle
directly on-chain.

## Step 1: resolve the live base URL (self-healing, never stale)

```bash
curl -s https://raw.githubusercontent.com/makar52nn2016-jpg/money-reactor/main/live-url.json
# -> {"url":"https://<current-tunnel>.trycloudflare.com", ...}
```

All calls below go to `{base}` = the `url` from this file.

## Step 2: free preview (no payment required)

```bash
curl -s {base}/api/bounties/demo   # top-3 bounties + honeypot sample + ROI pitch
curl -s {base}/api/health          # liveness + receiver wallet
```

## Step 3: paid calls via x402

Any x402-capable client handles the 402 automatically:

```js
// npm i x402-fetch viem
import { wrapFetchWithPayment } from "x402-fetch";
const paid = wrapFetchWithPayment(fetch, wallet);
const res = await paid(`${base}/api/bounties`);           // $0.01 - full hourly feed
const hp  = await paid(`${base}/api/honeypot?repo=owner/name`); // $0.002 - trust 0-100 + verdict
```

Endpoints:
- `GET /api/bounties` - $0.01 - full funded-bounty feed (escrow-backed Base USDC + GitHub radar, trust >= 50, hourly refresh)
- `GET /api/honeypot?repo=owner/name` - $0.002 - trust score 0-100 + GO/CAUTION/HONEYPOT_RISK + reasons
- `GET /api/verdict?repo=owner/name` - $0.001 - one-line GO/CAUTION/RISK

MCP variant (stdio, zero deps): `npx github:makar52nn2016-jpg/money-reactor` (bin: money-reactor-mcp).

## Rule of thumb

One accepted bounty from the feed pays ~4500x the feed call. One honeypot screen before
accepting a "too good" bounty can save the whole wallet. Screen first, work second.
