#!/bin/bash
# claude-mem installer for OpenClaw

set -e

echo "🧠 Installing claude-mem..."

# Check dependencies
command -v node >/dev/null 2>&1 || { echo "❌ Node.js required"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "❌ npm required"; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "⚠️ Claude Code CLI not found - install manually"; }

# Create plugins directory
PLUGINS_DIR="$HOME/.claude/plugins/marketplaces"
mkdir -p "$PLUGINS_DIR"

# Clone or update repo
if [ -d "$PLUGINS_DIR/thedotmack" ]; then
  echo "📦 Updating existing installation..."
  cd "$PLUGINS_DIR/thedotmack"
  git pull
else
  echo "📦 Cloning claude-mem..."
  cd "$PLUGINS_DIR"
  git clone https://github.com/thedotmack/claude-mem.git thedotmack
fi

# Install dependencies
cd "$PLUGINS_DIR/thedotmack"
echo "📦 Installing npm dependencies..."
npm install

# Register marketplace with Claude Code so it recognizes the plugin
echo "📝 Registering marketplace with Claude Code..."
KNOWN_MARKETPLACES="$HOME/.claude/plugins/known_marketplaces.json"

# Create or update known_marketplaces.json
if [ -f "$KNOWN_MARKETPLACES" ]; then
  # Check if thedotmack already registered
  if grep -q "thedotmack" "$KNOWN_MARKETPLACES"; then
    echo "  ✓ Marketplace already registered"
  else
    # Add thedotmack to existing file using jq or fallback
    if command -v jq >/dev/null 2>&1; then
      jq '. + {"thedotmack": {"source": {"source": "github", "repo": "thedotmack/claude-mem"}, "installLocation": "'"$PLUGINS_DIR/thedotmack"'", "lastUpdated": "'"$(date -Iseconds)"'"}}' "$KNOWN_MARKETPLACES" > "$KNOWN_MARKETPLACES.tmp"
      mv "$KNOWN_MARKETPLACES.tmp" "$KNOWN_MARKETPLACES"
      echo "  ✓ Added to existing marketplaces"
    else
      echo "  ⚠️ jq not found - creating fresh marketplaces file"
      cat > "$KNOWN_MARKETPLACES" << EOF
{
  "thedotmack": {
    "source": {"source": "github", "repo": "thedotmack/claude-mem"},
    "installLocation": "$PLUGINS_DIR/thedotmack",
    "lastUpdated": "$(date -Iseconds)"
  }
}
EOF
    fi
  fi
else
  # Create new file
  cat > "$KNOWN_MARKETPLACES" << EOF
{
  "thedotmack": {
    "source": {"source": "github", "repo": "thedotmack/claude-mem"},
    "installLocation": "$PLUGINS_DIR/thedotmack",
    "lastUpdated": "$(date -Iseconds)"
  }
}
EOF
  echo "  ✓ Created marketplaces registry"
fi

# Create default config if not exists
CONFIG_DIR="$HOME/.claude-mem"
mkdir -p "$CONFIG_DIR"

if [ ! -f "$CONFIG_DIR/settings.json" ]; then
  echo "⚙️ Creating default config..."
  cat > "$CONFIG_DIR/settings.json" << 'EOF'
{
  "model": "claude-sonnet-4-20250514",
  "workerPort": 37777,
  "dataDir": "~/.claude-mem/data",
  "logLevel": "info",
  "contextInjection": {
    "enabled": true,
    "maxTokens": 4000
  }
}
EOF
fi

echo ""
echo "✅ claude-mem installed and registered!"
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code"
echo "  2. Web viewer: http://localhost:37777"
echo "  3. Config: ~/.claude-mem/settings.json"
echo ""
echo "All new Claude Code sessions (including OpenClaw-spawned) will use claude-mem automatically."
echo ""
