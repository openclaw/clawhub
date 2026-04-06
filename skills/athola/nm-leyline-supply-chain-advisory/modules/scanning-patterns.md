# Scanning Patterns

## Lockfile Audit

For each lockfile type, extract package names and versions, then compare
against the known-bad-versions blocklist.

### uv.lock

```python
import re
from pathlib import Path

def parse_uv_lock(path: Path) -> dict[str, str]:
    """Extract package->version mapping from uv.lock."""
    packages = {}
    content = path.read_text()
    for match in re.finditer(
        r'^name\s*=\s*"([^"]+)".*?^version\s*=\s*"([^"]+)"',
        content,
        re.MULTILINE | re.DOTALL,
    ):
        packages[match.group(1)] = match.group(2)
    return packages
```

### requirements.txt

```python
def parse_requirements(path: Path) -> dict[str, str]:
    """Extract package->version from pinned requirements."""
    packages = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if "==" in line and not line.startswith("#"):
            name, version = line.split("==", 1)
            packages[name.strip()] = version.strip()
    return packages
```

## Artifact Scanning

Search for known malicious file indicators across a directory tree:

```python
from pathlib import Path

def scan_for_artifacts(root: Path, indicators: list[str]) -> list[Path]:
    """Find known malicious artifacts in a directory tree."""
    found = []
    for indicator in indicators:
        found.extend(root.rglob(indicator))
    return found
```

## Version Matching

```python
def is_compromised(
    package: str,
    version: str,
    blocklist: dict,
) -> dict | None:
    """Check if a package version is in the known-bad blocklist."""
    entries = blocklist.get(package, [])
    for entry in entries:
        if version in entry["versions"]:
            return entry
    return None
```
