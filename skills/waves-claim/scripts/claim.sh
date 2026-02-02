#!/bin/bash
# Claim a free SURF Waves Card NFT
# Usage: PRIVATE_KEY=0x... ./claim.sh

set -e

# Contract addresses
CLAIM_VAULT="${CLAIM_VAULT:-0xAF1906B749339adaE38A1cba9740fffA168897c2}"
RPC_URL="${RPC_URL:-https://mainnet.base.org}"

# Check dependencies
if ! command -v cast &> /dev/null; then
  echo "❌ Foundry 'cast' not found. Install: curl -L https://foundry.paradigm.xyz | bash"
  exit 1
fi

if ! command -v jq &> /dev/null; then
  echo "❌ 'jq' not found. Install: sudo apt install jq"
  exit 1
fi

# Get private key
if [ -z "$PRIVATE_KEY" ]; then
  echo "❌ PRIVATE_KEY environment variable required"
  echo "Usage: PRIVATE_KEY=0x... ./claim.sh"
  exit 1
fi

# Derive wallet address
WALLET=$(cast wallet address "$PRIVATE_KEY" 2>&1) || {
  echo "❌ Invalid private key: $WALLET"
  exit 1
}

echo "🎴 SURF Waves Card Claim"
echo "   Wallet: $WALLET"
echo ""

# Check if can claim (convert hex to decimal for comparison)
CAN_CLAIM=$(cast call "$CLAIM_VAULT" "canClaim(address)(bool)" "$WALLET" --rpc-url "$RPC_URL" 2>&1) || {
  echo "❌ RPC error checking canClaim: $CAN_CLAIM"
  exit 1
}

if [ "$CAN_CLAIM" != "true" ]; then
  TIME_HEX=$(cast call "$CLAIM_VAULT" "timeUntilClaim(address)(uint256)" "$WALLET" --rpc-url "$RPC_URL" 2>&1) || {
    echo "❌ RPC error: $TIME_HEX"
    exit 1
  }
  TIME_LEFT=$(cast to-dec "$TIME_HEX" 2>/dev/null || echo "0")
  MINUTES=$((TIME_LEFT / 60))
  echo "⏳ Cooldown active. Try again in ${MINUTES} minutes."
  exit 1
fi

# Check available cards
AVAILABLE_HEX=$(cast call "$CLAIM_VAULT" "availableCount()(uint256)" --rpc-url "$RPC_URL" 2>&1) || {
  echo "❌ RPC error: $AVAILABLE_HEX"
  exit 1
}
AVAILABLE=$(cast to-dec "$AVAILABLE_HEX" 2>/dev/null || echo "0")

if [ "$AVAILABLE" = "0" ]; then
  echo "❌ No cards available in vault"
  exit 1
fi

echo "📦 Cards available: $AVAILABLE"
echo "🚀 Claiming..."

# Execute claim transaction
TX_OUTPUT=$(cast send "$CLAIM_VAULT" "claim()" \
  --private-key "$PRIVATE_KEY" \
  --rpc-url "$RPC_URL" \
  --json 2>&1)

TX_STATUS=$?
if [ $TX_STATUS -ne 0 ]; then
  echo "❌ Transaction failed: $TX_OUTPUT"
  exit 1
fi

# Extract transaction hash
TX_HASH=$(echo "$TX_OUTPUT" | jq -r '.transactionHash // empty')

if [ -z "$TX_HASH" ] || [ "$TX_HASH" = "null" ]; then
  echo "❌ Failed to get transaction hash"
  echo "Raw output: $TX_OUTPUT"
  exit 1
fi

echo ""
echo "✅ Claim successful!"
echo "🔗 TX: https://basescan.org/tx/$TX_HASH"
echo ""
echo "View your cards: https://opensea.io/account"
