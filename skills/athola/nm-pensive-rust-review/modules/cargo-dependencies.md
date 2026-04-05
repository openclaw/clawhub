---
name: cargo-dependencies
description: Dependency auditing, security scanning, and version management
category: rust-review
tags: [cargo, dependencies, security, audit]
---

# Cargo Dependencies

Audit and management of Cargo dependencies and build configuration.

## Audit Commands

Run detailed dependency analysis:
```bash
cargo tree -d              # Find duplicates
cargo audit                # Security vulnerabilities
cargo outdated             # Stale versions
cargo deny check           # Policy enforcement
```

## Dependency Evaluation

Check:
- Feature flags usage
- Optional dependencies
- Build scripts safety
- Binary size impact
- Compilation time

## Security Scanning

Review for:
- Known vulnerabilities
- Abandoned crates
- Unmaintained dependencies
- Security advisories
- Supply chain risks

## Version Management

Verify:
- Semver compliance
- Version pinning strategy
- Dependency updates frequency
- Breaking change handling

## Common Issues

Flag:
- Abandoned crates
- Excessively large dependencies
- Security-vulnerable versions
- Duplicate dependencies
- Unnecessary dependencies

## Alternatives Suggestion

Recommend alternatives for:
- Unmaintained crates
- Heavy dependencies
- Vulnerable versions
- Better maintained options

## Output Section

```markdown
## Dependencies
### Security Issues
- [crate@version] Vulnerability: [CVE/advisory]

### Recommendations
- Update [crate] from X to Y
- Replace [abandoned-crate] with [alternative]
- Remove unused dependency: [crate]
```
