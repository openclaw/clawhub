# node-transfer

**High-speed, memory-efficient file transfer for OpenClaw nodes**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](./version.js)
[![Node.js](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./package.json)

---

## 🚀 Quick Start

### 1. Deploy to a Node (One-Time)

```bash
node deploy.js E3V3
```

### 2. Transfer a File

```javascript
const INSTALL_DIR = 'C:/openclaw/skills/node-transfer/scripts';

// Start sender
const send = await nodes.invoke({
    node: 'E3V3',
    command: ['node', `${INSTALL_DIR}/send.js`, 'C:/data/file.zip']
});
const { url, token } = JSON.parse(send.output);

// Start receiver
await nodes.invoke({
    node: 'E3V3-Docker',
    command: ['node', `${INSTALL_DIR}/receive.js`, url, token, '/incoming/file.zip']
});
```

---

## 📦 Package Contents

| File | Description |
|------|-------------|
| `send.js` | HTTP server that streams files |
| `receive.js` | HTTP client that downloads files |
| `ensure-installed.js` | Fast installation checker |
| `version.js` | Version manifest |
| `deploy.js` | Deployment script generator |
| `example.js` | Complete usage example |
| `SKILL.md` | Full documentation |
| `CONTRIBUTING_PROPOSAL.md` | Core integration proposal |

---

## 📊 Performance

| Metric | Base64 Transfer | node-transfer | Speedup |
|--------|-----------------|---------------|---------|
| 1GB file | 15-30 min | ~8 sec | **~150x** |
| Memory usage | 1GB+ | <10MB | **99% less** |
| First check | - | <100ms | N/A |

---

## 📖 Documentation

- **[SKILL.md](./SKILL.md)** - Complete usage guide, API reference, troubleshooting
- **[CONTRIBUTING_PROPOSAL.md](./CONTRIBUTING_PROPOSAL.md)** - Proposal for core integration
- **[example.js](./example.js)** - Working code example

---

## 🔧 Requirements

- Node.js 14.0.0 or higher
- Network connectivity between nodes
- Sufficient disk space on destination

---

## 🤝 Contributing

See [CONTRIBUTING_PROPOSAL.md](./CONTRIBUTING_PROPOSAL.md) for information on integrating this into OpenClaw core.

---

*Built for OpenClaw - No Base64, No OOM, No Waiting.*
