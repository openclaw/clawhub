---
name: mova-hitl-contracts
description: >
  Run regulated business decisions through MOVA — a Human-in-the-Loop contract
  runtime. Contracts pause at decision points where a human must formally approve.
  Every action is audited. BYOK: bring your own LLM key.
version: 0.1.0
homepage: https://github.com/mova-compact/MOVA_Claw
emoji: 📋
license: MIT-0

metadata:
  openclaw:
    primaryEnv: MOVA_API_KEY
    requires:
      env:
        - MOVA_API_KEY
        - MOVA_API_URL
        - LLM_KEY
    install:
      - kind: uv
        packages:
          - httpx
---

# MOVA — Human-in-the-Loop Contract Runtime

MOVA runs AI agents under formal contracts. When the agent reaches a decision
point, the contract **pauses** in `waiting_human` state. It cannot advance until
a human submits a formal decision via the API — with their actor ID, reason, and
selected option. The output is a signed audit receipt.

## Setup

Add to your environment (`.env.local` or OpenClaw secrets):

```
MOVA_API_URL=https://mova-runtime-rs.s-myasoedov81.workers.dev
MOVA_API_KEY=<your-mova-api-key>
LLM_KEY=<your-openrouter-key>
LLM_MODEL=openai/gpt-4o-mini
```

Get a MOVA API key: https://github.com/mova-compact/MOVA_Claw

## Available Contracts

| Contract ID | What it does | Human decision |
|---|---|---|
| `finance.invoice_ocr` | Invoice validation — IBAN, VAT, duplicate checks | AP: approve / hold / reject |
| `erp.po_approval` | Purchase order review — vendor, budget, fraud patterns | Procurement: approve / hold / escalate |
| `crypto.trade_review` | Trade risk — sanctions screening, portfolio exposure | Trading desk: approve / reject / escalate |
| `finance.cfo_payment_approval` | Large payment — cashflow impact, entity screening | CFO: approve / hold / board escalation |
| `medical.clinical_support` | Clinical decision — drug interactions, lab reference | Physician: proceed / escalate / consult |

## Usage

### Start a contract

```
@openclaw run mova contract finance.invoice_ocr with invoice_number=INV-2026-0042 vendor_id=VND-8821 amount=47000 currency=EUR iban=DE89370400440532013000
```

OpenClaw will:
1. Start the contract via `POST /api/v1/contracts`
2. Execute the AI analysis step (calls OCR, vendor registry, IBAN validation tools)
3. Report the AI finding and pause at the decision point
4. Wait for your decision

### Submit a decision

```
@openclaw mova decide <contract_id> hold_for_review "IBAN differs from vendor registry"
```

### Check contract status

```
@openclaw mova status <contract_id>
```

### Get audit receipt

```
@openclaw mova audit <contract_id>
```

## How it works

```
START → ai_task (multi-turn LLM + connector tools)
      → verification (builds risk snapshot)
      → decision_point ← contract PAUSES here
                         human submits decision
      → COMPLETE + audit receipt
```

The contract runtime enforces the boundary between what the AI can decide
autonomously and what requires human judgment. Every decision is:
- Attributed to a named actor
- Timestamped
- Stored in an immutable audit log

## Example output

```json
{
  "audit_receipt": {
    "contract_id": "crt-a1b2c3d4",
    "template_id": "tpl.finance.invoice_ocr_hitl_v0",
    "status": "completed",
    "decision_log": [{
      "decision_kind": "ap_action",
      "selected_option_id": "hold_for_review",
      "selected_by": "ap-manager@company.com",
      "selection_reason": "IBAN differs from vendor registry — flagged for fraud review",
      "selected_at": "2026-03-19T14:32:07Z"
    }]
  }
}
```

## BYOK — Bring Your Own Key

MOVA orchestration is free. You pay your LLM provider directly.
Pass `LLM_KEY` and optionally `LLM_MODEL` — any model on OpenRouter works:
`openai/gpt-4o`, `anthropic/claude-sonnet-4-5`, `google/gemini-2.0-flash`, etc.

## Source & feedback

Repo: https://github.com/mova-compact/MOVA_Claw
HN discussion: https://news.ycombinator.com/item?id=47437723
