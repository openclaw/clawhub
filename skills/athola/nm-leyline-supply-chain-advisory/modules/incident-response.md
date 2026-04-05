# Incident Response

## Triage Checklist

When a supply chain compromise is reported:

### 1. Scope Assessment (5 minutes)

- [ ] Identify affected package name and versions
- [ ] Search all lockfiles on machine: `rg "package.*version" --glob "uv.lock" ~` (or `grep -r --include="uv.lock"`)
- [ ] Check installed versions: `find ~ -path "*/.venv/*/METADATA" -exec rg Version {} +` (or `grep`)
- [ ] Search for malicious artifacts: `find ~ -name "indicator_file" 2>/dev/null`

### 2. Containment (if affected)

- [ ] Stop any running processes using the affected package
- [ ] Do NOT delete the virtualenv yet (preserve for forensics)
- [ ] Disconnect from sensitive services if credential theft suspected
- [ ] Capture current environment: `env > /tmp/env_snapshot_$(date +%s).txt`

### 3. Remediation

- [ ] Add version exclusions to `pyproject.toml`: `!=affected.version`
- [ ] Remove malicious artifacts from virtualenvs
- [ ] Regenerate lockfile: `uv lock`
- [ ] Reinstall: `uv sync`
- [ ] Rotate ALL credentials that were accessible to the process

### 4. Credential Rotation Priority

If a credential-stealing payload was present, rotate in this order:

1. **Cloud provider keys** (AWS, GCP, Azure) — highest blast radius
2. **Database passwords** — data exfiltration risk
3. **SSH keys** — lateral movement risk
4. **API tokens** — service access
5. **Kubernetes tokens** — cluster compromise
6. **Environment variables** — may contain any of the above

### 5. Documentation

- [ ] Add incident to `docs/dependency-audit.md`
- [ ] Update `known-bad-versions.json` blocklist
- [ ] File GitHub issue linking to advisory
- [ ] Notify team members who may have affected environments

## Post-Incident Review

After containment, evaluate:

1. Why did existing tooling not catch this?
2. What detection layer would have caught it earliest?
3. Should scanning frequency be increased?
4. Are there similar packages in our dependency tree at risk?
