---
name: waves-claim
description: Claim free SURF Waves Card NFTs on Base. One random card every 2 hours.
homepage: https://opensea.io/collection/surf-waves-cards
metadata:
  openclaw:
    emoji: "🎴"
    category: "web3"
    requires:
      bins: ["cast"]
---

# Waves Claim Skill

Claim free SURF Waves Card NFTs on Base blockchain.

## Install

```bash
clawhub install waves-claim
```

Or one-click:
```bash
curl -sL https://raw.githubusercontent.com/openclaw/clawhub/main/skills/waves-claim/install.sh | bash
```

## Overview

The WavesTCG ClaimVault distributes free trading card NFTs. Any wallet can claim one random card every 2 hours.

## Contract Info

| Property | Value |
|----------|-------|
| **ClaimVault** | `0xAF1906B749339adaE38A1cba9740fffA168897c2` |
| **NFT Contract** | `0xcc2d6ba8564541e6e51fe5522e26d4f4bbdd458b` |
| **Network** | Base (Chain ID: 8453) |
| **Cooldown** | 2 hours |
| **RPC** | `https://mainnet.base.org` |

## Prerequisites

- Wallet with private key
- Small amount of ETH on Base for gas (~0.0001 ETH)
- Foundry's `cast` CLI (at `~/.foundry/bin/cast`)

## Quick Claim (cast)

```bash
export PATH="$HOME/.foundry/bin:$PATH"
export VAULT="0xAF1906B749339adaE38A1cba9740fffA168897c2"  # ClaimVault address
export RPC="https://mainnet.base.org"
export PRIVATE_KEY="0x..."  # Your private key

# 1. Check if you can claim
CAN_CLAIM=$(cast call $VAULT "canClaim(address)" $(cast wallet address --private-key $PRIVATE_KEY) --rpc-url $RPC)
echo "Can claim: $CAN_CLAIM"

# 2. If true, claim!
if [ "$CAN_CLAIM" = "0x0000000000000000000000000000000000000000000000000000000000000001" ]; then
  cast send $VAULT "claim()" --rpc-url $RPC --private-key $PRIVATE_KEY
fi
```

## Check Cooldown

```bash
# Get seconds until next claim
cast call $VAULT "timeUntilClaim(address)" YOUR_ADDRESS --rpc-url $RPC | cast to-dec
```

## Check Available Cards

```bash
cast call $VAULT "availableCount()" --rpc-url $RPC | cast to-dec
```

## Full Claim Script

```bash
#!/bin/bash
# waves-claim.sh - Claim a free SURF Waves card

export PATH="$HOME/.foundry/bin:$PATH"
VAULT="0xAF1906B749339adaE38A1cba9740fffA168897c2"  # UPDATE THIS
RPC="https://mainnet.base.org"

# Load private key from credentials
PRIVATE_KEY=$(jq -r '.private_key' ~/.config/clawtasks/credentials.json)
WALLET=$(cast wallet address --private-key $PRIVATE_KEY)

echo "🌊 SURF Waves Claim"
echo "Wallet: $WALLET"

# Check available
AVAILABLE=$(cast call $VAULT "availableCount()" --rpc-url $RPC | cast to-dec)
echo "Available cards: $AVAILABLE"

if [ "$AVAILABLE" = "0" ]; then
  echo "❌ No cards available"
  exit 1
fi

# Check cooldown
CAN_CLAIM=$(cast call $VAULT "canClaim(address)" $WALLET --rpc-url $RPC)

if [ "$CAN_CLAIM" != "0x0000000000000000000000000000000000000000000000000000000000000001" ]; then
  REMAINING=$(cast call $VAULT "timeUntilClaim(address)" $WALLET --rpc-url $RPC | cast to-dec)
  HOURS=$((REMAINING / 3600))
  MINS=$(((REMAINING % 3600) / 60))
  echo "⏰ Cooldown: ${HOURS}h ${MINS}m remaining"
  exit 1
fi

echo "🎯 Claiming..."
TX=$(cast send $VAULT "claim()" --rpc-url $RPC --private-key $PRIVATE_KEY --json)
HASH=$(echo $TX | jq -r '.transactionHash')

echo "✅ Claimed! TX: $HASH"
echo "View on BaseScan: https://basescan.org/tx/$HASH"
```

## Scheduled Claiming

To claim automatically every 2 hours, use OpenClaw cron:

```
/cron add "waves-claim" "0 */2 * * *" "Run ~/.openclaw/skills/waves-claim/claim.sh and report result"
```

## JavaScript Example

```javascript
import { createPublicClient, createWalletClient, http } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const VAULT = '0x...'; // ClaimVault address

const abi = [
  'function canClaim(address) view returns (bool)',
  'function availableCount() view returns (uint256)',
  'function claim()'
];

export async function claimWavesCard(privateKey) {
  const account = privateKeyToAccount(privateKey);
  
  const publicClient = createPublicClient({
    chain: base,
    transport: http()
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http()
  });

  // Check eligibility
  const [canClaim, available] = await Promise.all([
    publicClient.readContract({ address: VAULT, abi, functionName: 'canClaim', args: [account.address] }),
    publicClient.readContract({ address: VAULT, abi, functionName: 'availableCount' })
  ]);

  if (!canClaim) return { success: false, reason: 'cooldown' };
  if (available === 0n) return { success: false, reason: 'empty' };

  const hash = await walletClient.writeContract({
    address: VAULT,
    abi,
    functionName: 'claim'
  });

  return { success: true, txHash: hash };
}
```

## Troubleshooting

**"Cooldown not expired"**  
Wait for 2 hours since your last claim.

**"No NFTs available"**  
The vault is empty. Cards are periodically added by the owner.

**"insufficient funds"**  
You need ETH on Base for gas. Bridge from mainnet or get from faucet.

## Links

- **Mini-App**: https://wavestcg.xyz/claim
- **OpenSea**: https://opensea.io/collection/surf-waves-cards
- **BaseScan NFT**: https://basescan.org/token/0xcc2d6ba8564541e6e51fe5522e26d4f4bbdd458b
