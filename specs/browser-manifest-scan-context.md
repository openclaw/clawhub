# Browser manifest install-source context

The install-source rule must distinguish Manifest V3 `host_permissions` and `optional_host_permissions` HTTP(S) match patterns from executable download sources. Recognize those fields only in a valid `manifest.json` with `manifest_version: 3`, and exclude only their string tokens from this rule.

Keep all other fields, malformed documents, and non-browser manifests subject to the existing install-source check. A permission and an install source may contain the same URL or share a line; excluding one must not hide the other, and findings must retain the original source line and evidence. Other static scanners and ClawScan still receive the full artifact. This correction does not grant a safety verdict or change historical audit results.
