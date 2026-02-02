#!/bin/bash
# Claim a free SURF Waves Card NFT

CLAIM_VAULT="${CLAIM_VAULT:-0xAF1906B749339adaE38A1cba9740fffA168897c2}"
RPC_URL="${RPC_URL:-https://mainnet.base.org}"

# Get private key
if [ -z "$PRIVATE_KEY" ]; then
  if [ -f ~/.config/clawtasks/credentials.json ]; then
    PRIVATE_KEY=$(jq -r '.private_key' ~/.config/clawtasks/credentials.json)
  fi
fi

if [ -z "$PRIVATE_KEY" ]; then
  echo "❌ Set PRIVATE_KEY env variable"
  exit 1
fi

WALLET=$(cast wallet address --private-key "$PRIVATE_KEY" 2>/dev/null)

echo "🎴 SURF Waves Cards - Claiming..."
echo "   Wallet: $WALLET"
echo "   Vault:  $CLAIM_VAULT"
echo ""

# Check if can claim first
CAN_CLAIM=$(cast call "$CLAIM_VAULT" "canClaim(address)(bool)" "$WALLET" --rpc-url "$RPC_URL" 2>/dev/null)

if [ "$CAN_CLAIM" != "true" ]; then
  TIME_LEFT=$(cast call "$CLAIM_VAULT" "timeUntilClaim(address)(uint256)" "$WALLET" --rpc-url "$RPC_URL" 2>/dev/null)
  MINUTES=$((TIME_LEFT / 60))
  echo "⏳ Cannot claim yet. Cooldown: ${MINUTES} minutes remaining"
  exit 1
fi

# Check available
AVAILABLE=$(cast call "$CLAIM_VAULT" "availableCount()(uint256)" --rpc-url "$RPC_URL" 2>/dev/null)
if [ "$AVAILABLE" = "0" ]; then
  echo "❌ No NFTs available in vault"
  exit 1
fi

echo "📦 Available: $AVAILABLE NFTs"
echo "🔨 Sending claim transaction..."

# Claim
TX=$(cast send "$CLAIM_VAULT" "claim()" \
  --private-key "$PRIVATE_KEY" \
  --rpc-url "$RPC_URL" \
  --json 2>/dev/null)

if [ $? -eq 0 ]; then
  TX_HASH=$(echo "$TX" | jq -r '.transactionHash')
  echo ""
  echo "✅ Claimed successfully!"
  echo "   TX: https://basescan.org/tx/$TX_HASH"
  echo ""
  echo "🎴 Check your new card on OpenSea:"
  echo "   https://opensea.io/collection/surf-waves-cards"
else
  echo "❌ Claim failed"
  echo "$TX"
  exit 1
fi
