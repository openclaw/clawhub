#!/bin/bash
# Test script for issue #825
# Verifies that `clawhub install --force` preserves local directory when checks fail

set -e

SKILLS_DIR="./test-skills"
TEST_SKILL="not-a-real-skill"

echo "🧪 Testing fix for issue #825..."
echo ""

# Cleanup from previous runs
rm -rf "$SKILLS_DIR"
mkdir -p "$SKILLS_DIR"

# Create a local skill directory to simulate an existing install
echo "📁 Creating test skill directory with precious data..."
mkdir -p "$SKILLS_DIR/$TEST_SKILL"
echo "PRECIOUS_DATA" > "$SKILLS_DIR/$TEST_SKILL/MARKER.txt"

# Verify the file exists
if [ ! -f "$SKILLS_DIR/$TEST_SKILL/MARKER.txt" ]; then
  echo "❌ Test setup failed: MARKER.txt not created"
  exit 1
fi

echo "✅ Test setup complete. MARKER.txt exists."
echo ""

# Try to force install a nonexistent slug
echo "🔨 Running: clawhub install $TEST_SKILL --force (expecting failure)..."
echo ""

# Run the install command (should fail because skill doesn't exist)
# Note: This will fail, but we're testing that the directory is NOT deleted
if ./packages/clawdhub/dist/cli.js install "$TEST_SKILL" --force --dir "$SKILLS_DIR" 2>&1; then
  echo "⚠️  Install succeeded unexpectedly (skill may exist now)"
else
  echo ""
  echo "✅ Install failed as expected (skill not found)"
fi

echo ""
echo "🔍 Checking if MARKER.txt still exists..."

# Check if the file still exists
if [ -f "$SKILLS_DIR/$TEST_SKILL/MARKER.txt" ]; then
  echo "✅ SUCCESS! MARKER.txt preserved. Fix is working correctly."
  echo ""
  echo "📄 Content of MARKER.txt:"
  cat "$SKILLS_DIR/$TEST_SKILL/MARKER.txt"
  echo ""
  exit 0
else
  echo "❌ FAILURE! MARKER.txt was deleted. The bug still exists."
  exit 1
fi

# Cleanup
rm -rf "$SKILLS_DIR"
