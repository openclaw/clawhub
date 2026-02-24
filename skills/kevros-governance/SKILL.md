---
name: kevros-governance
description: |
  Precision decisioning, agentic trust, and verifiable identity for autonomous agents.
  Cryptographic proof of authorization, hash-chained provenance, intent-to-action binding,
  and post-quantum attestation. It's math. Free tier: 100 calls/month.
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

# Kevros — Precision Decisioning & Agentic Trust Identity

Your agent has a wallet. It has no identity. Kevros gives it one.

Cryptographically signed. Hash-chained. Post-quantum attested. Independently verifiable by any agent, service, or regulator — without calling us. It's math.

## Three Problems, Three Primitives

### 1. Precision Decisioning
Agents need deterministic, cryptographically signed authorization — not probabilistic guessing.

`/governance/verify` → Returns a signed **ALLOW**, **CLAMP**, or **DENY** decision with a release token. Any downstream service can verify the token independently. Fail-closed: any doubt results in DENY.

### 2. Agentic Trust
Agents need to prove what they did, not just claim it. Trust is a chain of evidence, not a reputation score.

`/governance/attest` → Creates a hash-chained provenance record. Append-only, tamper-evident, independently auditable. Every attestation links to the previous one — break one link, the entire chain screams.

### 3. Verifiable Identity
An agent's identity is what it has done, cryptographically proven. Not a username. Not an API key.

`/governance/bind` → Binds intent to action with cryptographic commitment. Proves the agent intended to do exactly what it did — prevents TOCTOU attacks. The binding is the identity.

## What It Costs

| Primitive | What It Proves | Per Call |
|-----------|---------------|----------|
| `verify` | Agent is authorized (precision decision) | $0.01 |
| `attest` | Agent did what it said (trust chain) | $0.02 |
| `bind` | Intent matched action (identity proof) | $0.02 |
| `bundle` | All of the above in one certifier-grade package | $0.25 |

## Quick Start

```bash
# Sign up — free, instant, no payment method needed
curl -X POST https://governance.taskhawktech.com/signup \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "my-agent-v1"}'

# Returns: {"api_key": "kvrs_...", "tier": "free", "monthly_limit": 100}
```

```bash
# Precision decision: is this agent authorized?
curl -X POST https://governance.taskhawktech.com/governance/verify \
  -H "X-API-Key: kvrs_..." \
  -H "Content-Type: application/json" \
  -d '{
    "action_type": "trade_execution",
    "action_payload": {"symbol": "AAPL", "side": "buy", "shares": 100},
    "agent_id": "my-agent-v1"
  }'

# Returns: {"decision": "ALLOW", "release_token": "...", "provenance_hash": "sha256:...", "epoch": 1920}
# Present the release_token to any service. They verify it without calling us.
```

## Python SDK

```bash
pip install kevros
```

```python
from kevros_governance import GovernanceClient

client = GovernanceClient(agent_id="my-agent")  # auto-signs up if no key

# Precision decision
result = client.verify(
    action_type="deploy_config",
    action_payload={"service": "api-gateway", "env": "production"},
    agent_id="my-deploy-agent"
)
print(result.decision)       # "ALLOW" — deterministic, signed
print(result.release_token)  # Present this to prove authorization
```

## x402: Wallet Is Identity

Agents with USDC on Base pay per-call with no signup, no API key, no account:

```
POST /governance/verify → 402 Payment Required
→ Agent signs EIP-712 typed data → Sends PAYMENT-SIGNATURE header
→ 200 OK (decision + payment settled in one HTTP round-trip)
```

The wallet IS the identity. The transaction history IS the trust chain. The signature IS the proof.

## A2A Agent Card

```
https://governance.taskhawktech.com/.well-known/agent.json
```

Discoverable by any A2A-protocol-compatible agent.

## Pricing

| Tier | Price | Calls/Month | For |
|------|-------|-------------|-----|
| Free | $0 | 100 | Evaluate — prove it works |
| Scout | $29/mo | 5,000 | Production agents |
| Sentinel | $149/mo | 50,000 | Enterprise fleets |
| Sovereign | $499/mo | 500,000 | Critical infrastructure |

## The Math

Every decision is:
- **HMAC-signed** — cryptographic proof of decision authority
- **Hash-chained** — append-only provenance (tamper = chain break = detection)
- **Post-quantum attested** — ML-DSA-87 signatures (quantum-resistant)
- **Independently verifiable** — no callback to our service needed

Precision decisioning. Agentic trust. Verifiable identity. It's math.

## Links

- Gateway: https://governance.taskhawktech.com
- Docs: https://governance.taskhawktech.com/docs
- Agent Card: https://governance.taskhawktech.com/.well-known/agent.json
- SDK: https://pypi.org/project/kevros/
- Provider: [TaskHawk Systems](https://taskhawktech.com)
