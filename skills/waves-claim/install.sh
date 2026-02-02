#!/bin/bash
# One-click install for SURF Waves Cards auto-claim skill
# Usage: curl -sL https://raw.githubusercontent.com/openclaw/clawhub/main/skills/waves-claim/install.sh | bash

set -e

SKILL_DIR="${OPENCLAW_SKILLS:-$HOME/.openclaw/skills}/waves-claim"
REPO_URL="https://raw.githubusercontent.com/openclaw/clawhub/main/skills/waves-claim"

echo "🎴 Installing SURF Waves Claim Skill..."

# Create directories
mkdir -p "$SKILL_DIR/scripts"

# Download files with error checking
download_file() {
  local url="$1"
  local dest="$2"
  local http_code
  
  http_code=$(curl -sL -w "%{http_code}" -o "$dest" "$url")
  
  if [ "$http_code" != "200" ]; then
    echo "❌ Failed to download $url (HTTP $http_code)"
    rm -f "$dest"
    return 1
  fi
}

echo "📥 Downloading skill files..."

download_file "$REPO_URL/SKILL.md" "$SKILL_DIR/SKILL.md" || exit 1
download_file "$REPO_URL/scripts/check-claim.sh" "$SKILL_DIR/scripts/check-claim.sh" || exit 1
download_file "$REPO_URL/scripts/claim.sh" "$SKILL_DIR/scripts/claim.sh" || exit 1

# Make scripts executable
chmod +x "$SKILL_DIR/scripts/"*.sh

echo ""
echo "✅ Installed to: $SKILL_DIR"
echo ""
echo "📋 Prerequisites:"
echo "   - Foundry cast: curl -L https://foundry.paradigm.xyz | bash"
echo "   - jq: sudo apt install jq (or brew install jq)"
echo "   - ETH on Base for gas (~0.0001 ETH)"
echo ""
echo "🚀 Usage:"
echo "   Check status:  $SKILL_DIR/scripts/check-claim.sh <wallet>"
echo "   Claim card:    PRIVATE_KEY=0x... $SKILL_DIR/scripts/claim.sh"
