#!/bin/bash
# Check if wallet can claim a SURF Waves Card

CLAIM_VAULT="${CLAIM_VAULT:-0xAF1906B749339adaE38A1cba9740fffA168897c2}"
RPC_URL="${RPC_URL:-https://mainnet.base.org}"

# Get wallet address from private key or env
if [ -n "$PRIVATE_KEY" ]; then
  WALLET=$(cast wallet address --private-key "$PRIVATE_KEY" 2>/dev/null)
elif [ -n "$WALLET" ]; then
  WALLET="$WALLET"
else
  # Try clawtasks credentials
  if [ -f ~/.config/clawtasks/credentials.json ]; then
    PRIVATE_KEY=$(jq -r '.private_key' ~/.config/clawtasks/credentials.json)
    WALLET=$(cast wallet address --private-key "$PRIVATE_KEY" 2>/dev/null)
  fi
fi

if [ -z "$WALLET" ]; then
  echo "❌ Set PRIVATE_KEY or WALLET env variable"
  exit 1
fi

echo "🎴 SURF Waves Cards - Claim Check"
echo "   Wallet: $WALLET"
echo "   Vault:  $CLAIM_VAULT"
echo ""

# Check available count
AVAILABLE=$(cast call "$CLAIM_VAULT" "availableCount()(uint256)" --rpc-url "$RPC_URL" 2>/dev/null)
echo "📦 Available NFTs: $AVAILABLE"

# Check if can claim
CAN_CLAIM=$(cast call "$CLAIM_VAULT" "canClaim(address)(bool)" "$WALLET" --rpc-url "$RPC_URL" 2>/dev/null)

if [ "$CAN_CLAIM" = "true" ]; then
  echo "✅ You can claim now!"
  echo ""
  echo "Run: ./scripts/claim.sh"
else
  # Get time remaining
  TIME_LEFT=$(cast call "$CLAIM_VAULT" "timeUntilClaim(address)(uint256)" "$WALLET" --rpc-url "$RPC_URL" 2>/dev/null)
  MINUTES=$((TIME_LEFT / 60))
  echo "⏳ Cooldown: ${MINUTES} minutes remaining"
fi
