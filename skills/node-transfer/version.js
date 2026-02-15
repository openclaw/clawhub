/**
 * node-transfer version manifest
 * 
 * This file tracks the version and expected file hashes for integrity checking.
 * Update this when any of the core files change.
 */

module.exports = {
    version: "1.0.0",
    description: "High-speed, memory-efficient file transfer between OpenClaw nodes",
    files: {
        // SHA-256 hashes (first 12 chars) of each file
        // These are computed automatically; do not edit manually
        "send.js": null,
        "receive.js": null,
        "ensure-installed.js": null
    },
    minNodeVersion: "14.0.0"
};
