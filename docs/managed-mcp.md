---
summary: "Publish and maintain company MCP integrations through the ClawHub management UI and admin CLI."
read_when:
  - Adding or updating a managed company MCP plugin
  - Installing a managed company MCP plugin
---

# Manage company MCP plugins

Administrators can publish remote MCP integrations under the OpenClaw publisher from **Management → Plugins → Add MCP integration**, or with `clawhub-admin managed-mcp`. The UI and CLI use the same authorized publication operation. The administrator must also have publishing access to the OpenClaw organization.

Each package contains a remote connection configuration, a short README, its icon, and license notices. OpenClaw publishes the wrapper; the named company operates the connected service. These packages do not contain provider implementations or local commands.

## Publish and update

Supply a stable integration id, version, company, current category, brief description, public HTTPS endpoint, transport, authentication settings, and a PNG icon. Icons must be original or MIT-licensed, with complete copyright attribution. The wrapper and included icon carry the MIT license.

```sh
clawhub-admin managed-mcp publish definition.json --dry-run
clawhub-admin managed-mcp publish definition.json
clawhub-admin managed-mcp get linear > linear.json
# Edit the definition and increment its version, then publish it.
clawhub-admin managed-mcp publish linear.json
clawhub-admin managed-mcp unpublish linear
```

`--dry-run` checks definition fields only. Icon decoding, endpoint compatibility, and security scans run during publication.

`publish` accepts one definition or an array of up to 200 definitions. A batch submits each entry through the same publication path. Stop on an error, correct the entry, and retry; normal immutable-version rules apply. Company integration lists are operational input to the CLI, maintained outside the application source tree and imported after the publishing code is deployed.

Use `oauth` with optional space-separated scopes, `api-key` with a header and an environment placeholder such as `Bearer ${SERVICE_TOKEN}`, or `none`. Never put credentials in the definition, endpoint, icon, or setup text. Keep endpoint paths, query restrictions, and HTTP/SSE transports as supplied by the service.

Publication checks the public endpoint and, for OAuth, discovery metadata advertising authorization, token, and dynamic-registration endpoints. This observation does not prove client registration, account eligibility, successful consent, or a live authenticated tool call.

Normal package validation and security gates apply, including to the OpenClaw publisher. A pending release is not installable. Scanning covers the published files and configuration; it does not certify the remote provider or its future tools.

## Install and connect

The OpenClaw consumer must include the [remote MCP loader fix](https://github.com/openclaw/openclaw/pull/162376). Until a release containing that fix is available, use a verified build containing it; older consumers may fail to start an agent session after enabling a remote MCP plugin.

Once available, users install the package through the normal OpenClaw plugin flow, enable it, and connect their account when required. API-key integrations require the named credential in a consumer that supports their environment placeholders. Account-level testing is separate from package validation.

OpenClaw's Control UI lists the plugin's MCP servers on its detail page. Follow the package's setup notes to connect the service.

Editing a connection creates a new immutable version. Installed copies retain their existing settings until updated. Unpublishing stops new availability through normal package policy; it does not uninstall existing copies.
