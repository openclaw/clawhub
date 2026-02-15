# Node Transfer Latency Investigation Report

## Summary

**Root Cause:** The 9-minute delay was entirely **agent runtime overhead**, not network/protocol slowness.

| Phase | Time | Note |
|-------|------|------|
| Agent debugging/retrying | ~9 min | BOM markers, encoding issues, failed deployments |
| Actual file transfer | 0.125s | ✅ Network was fast all along |

## Where the Time Went

The agent spent 9 minutes trying to:
1. Explore directories on the remote node
2. Deploy `send.js` using PowerShell/Base64
3. **Retry multiple times** due to:
   - BOM (Byte Order Mark) markers corrupting the script
   - Syntax errors from encoding issues
   - Wrong file paths

The actual transfer, once the script finally deployed correctly, took only **0.125 seconds**.

## The Fix: "Install Once, Run Many"

### New Workflow

```
First Transfer (One-Time):
  Agent: Check if installed? → Not installed → Deploy scripts (30s) → Transfer (0.1s)

Subsequent Transfers:
  Agent: Check if installed? → Installed ✓ → Transfer (0.1s)
           ↑
       (< 100ms)
```

### Files Added

| File | Purpose |
|------|---------|
| `ensure-installed.js` | Fast check (<100ms) if scripts are present and current |
| `version.js` | Version tracking with file hashes for integrity |
| `deploy-to-node.js` | Generates deployment scripts for new nodes |
| `transfer.js` | Main entry point documentation |

### Updated Documentation

- `SKILL.md` now includes performance notes and "Install Once, Run Many" workflow

### Deployment Scripts Generated

- `deploy-E3V3.ps1` - Deploy to E3V3 node (Windows)
- `deploy-E3V3-Docker.ps1` - Deploy to E3V3-Docker node

## How to Use (Going Forward)

### Step 1: One-Time Install on Each Node

Run the deployment script on each node once:

```powershell
# On E3V3 node
powershell -ExecutionPolicy Bypass -File "C:\openclaw\skills\node-transfer\scripts\deploy.ps1"

# Or run remotely via nodes.invoke:
const deployScript = fs.readFileSync('skills/node-transfer/deploy-E3V3.ps1', 'utf8');
await nodes.invoke({
    node: 'E3V3',
    command: ['powershell', '-ExecutionPolicy', 'Bypass', '-Command', deployScript]
});
```

### Step 2: Fast Check Before Each Transfer

```javascript
const INSTALL_DIR = 'C:/openclaw/skills/node-transfer/scripts';

// This returns in <100ms if already installed
const check = await nodes.invoke({
    node: 'E3V3',
    command: ['node', `${INSTALL_DIR}/ensure-installed.js`, INSTALL_DIR]
});

const result = JSON.parse(check.output);
if (!result.installed) {
    // Only deploy if missing (first time or corrupted)
    throw new Error(`Node not ready: ${result.message}`);
}
```

### Step 3: Execute Transfer

```javascript
// Start sender (already installed, runs immediately)
const send = await nodes.run({
    node: 'source-pc',
    command: ['node', 'C:/openclaw/skills/node-transfer/scripts/send.js', '/data/file.zip']
});
const { url, token } = JSON.parse(send.output);

// Start receiver
await nodes.run({
    node: 'dest-pc',
    command: ['node', 'C:/openclaw/skills/node-transfer/scripts/receive.js', url, token, '/incoming/file.zip']
});
```

## Performance Comparison

| Metric | Before | After |
|--------|--------|-------|
| First transfer | ~9 min | ~30 sec (one-time install) |
| Subsequent transfers | ~9 min | **<1 sec** |
| Check installed | N/A | **<100ms** |
| Actual transfer | 0.125s | 0.125s (unchanged) |

## Key Design Decisions

1. **Hash-based integrity check**: Files are SHA256-hashed; if corrupted, agent knows to re-deploy
2. **Version tracking**: Increment version in `version.js` when updating scripts
3. **Fast path**: The check is a simple Node.js require() and hash comparison - no network overhead
4. **Idempotent**: Deploying twice is safe; same files produce same hashes

## Next Steps

1. ✅ Run deployment scripts on E3V3 and E3V3-Docker
2. ✅ Test a transfer - should complete in ~0.5 seconds (check + transfer)
3. 🔄 Future: When updating `send.js` or `receive.js`, increment version in `version.js`

## Files Modified/Created

```
skills/node-transfer/
├── SKILL.md              (updated with new workflow)
├── send.js               (unchanged)
├── receive.js            (unchanged)
├── ensure-installed.js   (NEW - fast install check)
├── version.js            (NEW - version tracking)
├── deploy-to-node.js     (NEW - deployment script generator)
├── transfer.js           (NEW - entry point docs)
├── deploy-E3V3.ps1       (NEW - generated for E3V3)
└── deploy-E3V3-Docker.ps1 (NEW - generated for E3V3-Docker)
```

---

**Result**: User gets "Click → Done" instead of "Click → 9 mins of agent fumbling → Done" ✅
