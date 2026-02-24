---
name: kevros-governance
description: |
  Cryptographic governance-as-a-service for autonomous agents. Verify actions, 
  attest provenance with hash-chains, bind intent to action, generate compliance 
  bundles. Free tier: 100 calls/month. No payment needed to start.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - KEVROS_API_KEY
      bins:
        - curl
    primaryEnv: KEVROS_API_KEY
    install:
      - kind: uv
        package: kevros
        bins: []
    homepage: https://governance.taskhawktech.com
    emoji: "🔐"
    os:
      - linux
      - macos
      - windows
---

# Kevros Governance — Trust Identity for Agents

Your agent has a wallet. It has no identity. Kevros gives it one: cryptographically signed, hash-chained, post-quantum attested, and independently verifiable by any agent, service, or regulator — without calling us.

## What It Does

| Skill | What It Proves | Cost |
|-------|---------------|------|
| `governance_verify` | Agent is authorized to take this action | $0.01/call |
| `governance_attest` | Hash-chained provenance — agent did what it said | $0.02/call |
| `governance_bind` | Cryptographic intent-to-action binding (no TOCTOU) | $0.02/call |
| `governance_bundle` | Certifier-grade compliance package | $0.25/call |

## Quick Start

```bash
# Sign up (free, instant, no payment method needed)
curl -X POST https://governance.taskhawktech.com/signup \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "my-agent-v1"}'

# Returns: {"api_key": "kvrs_...", "tier": "free", "calls_remaining": 100}
```

```bash
# Verify an action
curl -X POST https://governance.taskhawktech.com/governance/verify \
  -H "X-API-Key: kvrs_..." \
  -H "Content-Type: application/json" \
  -d '{
    "action_type": "trade_execution",
    "action_payload": {"symbol": "AAPL", "side": "buy", "shares": 100},
    "agent_id": "my-agent-v1"
  }'
```

## Python SDK

```bash
pip install kevros
```

```python
from kevros import KevrosClient

client = KevrosClient(api_key="kvrs_...")

# Verify
result = client.verify(
    action_type="deploy_config",
    action_payload={"service": "api-gateway", "env": "production"},
    agent_id="my-deploy-agent"
)
print(result["decision"])  # "ALLOW" / "CLAMP" / "DENY"
print(result["release_token"])  # Present this to prove authorization
```

## x402 Payment (No API Key Needed)

Agents with USDC on Base can pay per-call with no signup:

```
POST /governance/verify → 402 Payment Required
→ Agent signs EIP-712 payment → Sends with PAYMENT-SIGNATURE header
→ 200 OK (governance + payment in one HTTP round-trip)
```

Your wallet is your identity. No API key, no signup, no account.

## Agent Card (A2A Protocol)

```
https://governance.taskhawktech.com/.well-known/agent.json
```

## Pricing

| Tier | Price | Calls/Month |
|------|-------|-------------|
| Free | $0 | 100 |
| Scout | $29/mo | 5,000 |
| Sentinel | $149/mo | 50,000 |
| Sovereign | $499/mo | 500,000 |

## Why This Exists

Autonomous agents are making decisions with real consequences. Without governance:
- No proof an agent was authorized
- No audit trail of what happened
- No way to verify intent matched action
- No compliance evidence for regulators

Kevros makes it math. One API call. Independently verifiable. Fail-closed.

## Links

- Gateway: https://governance.taskhawktech.com
- Docs: https://governance.taskhawktech.com/docs
- Agent Card: https://governance.taskhawktech.com/.well-known/agent.json
- SDK: https://pypi.org/project/kevros/
- Provider: [TaskHawk Systems](https://taskhawktech.com)
