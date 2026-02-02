#!/bin/bash
# Check if wallet can claim from SURF Waves ClaimVault
# Usage: ./check-claim.sh [wallet_address]

set -e

# Contract addresses
CLAIM_VAULT="${CLAIM_VAULT:-0xAF1906B749339adaE38A1cba9740fffA168897c2}"
NFT_CONTRACT="${NFT_CONTRACT:-0xcc2d6ba8564541e6e51fe5522e26d4f4bbdd458b}"
RPC_URL="${RPC_URL:-https://mainnet.base.org}"

# Check for cast
if ! command -v cast &> /dev/null; then
  echo "❌ Foundry 'cast' not found. Install: curl -L https://foundry.paradigm.xyz | bash"
  exit 1
fi

# Get wallet from arg or derive from private key
WALLET="${1:-}"
if [ -z "$WALLET" ] && [ -n "$PRIVATE_KEY" ]; then
  WALLET=$(cast wallet address "$PRIVATE_KEY" 2>&1) || {
    echo "❌ Failed to derive wallet from PRIVATE_KEY"
    exit 1
  }
fi

if [ -z "$WALLET" ]; then
  echo "Usage: ./check-claim.sh <wallet_address>"
  echo "   Or: PRIVATE_KEY=0x... ./check-claim.sh"
  exit 1
fi

echo "🎴 SURF Waves ClaimVault Status"
echo "   Vault:  $CLAIM_VAULT"
echo "   Wallet: $WALLET"
echo ""

# Get available count (convert hex to decimal)
AVAILABLE_HEX=$(cast call "$CLAIM_VAULT" "availableCount()(uint256)" --rpc-url "$RPC_URL" 2>&1) || {
  echo "❌ RPC error fetching availableCount: $AVAILABLE_HEX"
  exit 1
}
AVAILABLE=$(cast to-dec "$AVAILABLE_HEX" 2>/dev/null || echo "0")
echo "📦 Cards available: $AVAILABLE"

# Check if can claim
CAN_CLAIM=$(cast call "$CLAIM_VAULT" "canClaim(address)(bool)" "$WALLET" --rpc-url "$RPC_URL" 2>&1) || {
  echo "❌ RPC error checking canClaim: $CAN_CLAIM"
  exit 1
}

if [ "$CAN_CLAIM" = "true" ]; then
  echo "✅ You CAN claim now!"
  echo ""
  echo "Run: ./claim.sh"
else
  # Get time until next claim (convert hex to decimal)
  TIME_HEX=$(cast call "$CLAIM_VAULT" "timeUntilClaim(address)(uint256)" "$WALLET" --rpc-url "$RPC_URL" 2>&1) || {
    echo "❌ RPC error fetching timeUntilClaim: $TIME_HEX"
    exit 1
  }
  TIME_LEFT=$(cast to-dec "$TIME_HEX" 2>/dev/null || echo "0")
  MINUTES=$((TIME_LEFT / 60))
  SECONDS=$((TIME_LEFT % 60))
  echo "⏳ Cooldown: ${MINUTES}m ${SECONDS}s remaining"
fi
