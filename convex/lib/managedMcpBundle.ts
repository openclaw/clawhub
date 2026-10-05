import { MANAGED_MCP_DEFINITION_PATH, parseManagedMcpDefinition } from "clawhub-schema";
import { validateSkillPresentationIcon } from "./skillPresentation";

const WRAPPER_LICENSE = `MIT License

Copyright (c) 2026 OpenClaw contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

/** Pure, deterministic authoring: no fetched code, endpoint calls or credentials. */
export function buildManagedMcpBundle(raw: unknown) {
  const definition = parseManagedMcpDefinition(raw);
  const { id, name, company, description, category, version, connection, icon } = definition;
  const separateIconRights = icon.license !== "MIT";
  const packageLicense = separateIconRights ? "SEE LICENSE IN LICENSE" : "MIT";
  const packageName = `@openclaw/${id}`;
  const auth = connection.auth;
  const server = {
    url: connection.url,
    ...(definition.setup ? { description: definition.setup } : {}),
    // These bundles target OpenClaw: its OAuth runtime reads singular `scope`.
    // Do not substitute another client's `scopes` field and lose reviewed permissions.
    ...(auth.kind === "oauth"
      ? { auth: "oauth", ...(auth.scope ? { oauth: { scope: auth.scope } } : {}) }
      : {}),
    ...(auth.kind === "api-key" ? { headers: { [auth.header]: auth.placeholder } } : {}),
  };
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const textFiles: Record<string, string> = {
    "package.json": json({
      name: packageName,
      version,
      description,
      license: packageLicense,
      author: "OpenClaw",
    }),
    "openclaw.plugin.json": json({
      id,
      name,
      version,
      description,
      categories: [category],
      configSchema: { type: "object", additionalProperties: false, properties: {} },
      mcpServers: { [id]: { ...server, transport: connection.transport } },
    }),
    ".claude-plugin/plugin.json": json({
      name: id,
      version,
      description,
      author: { name: "OpenClaw" },
      // This optional manifest field requires SPDX; mixed asset rights live in LICENSE/NOTICE.
      ...(separateIconRights ? {} : { license: "MIT" }),
      mcpServers: "./.mcp.json",
    }),
    ".mcp.json": json({
      mcpServers: { [id]: { ...server, type: connection.transport === "sse" ? "sse" : "http" } },
    }),
    [MANAGED_MCP_DEFINITION_PATH]: json(definition),
    "README.md": `${description}\n\nMCP service operated by ${company}. Wrapper published by OpenClaw.\n${definition.setup ? `\n${definition.setup}\n` : ""}`,
    LICENSE: separateIconRights
      ? `The following MIT license covers the wrapper. It does not apply to assets/icon.png; see NOTICE for the icon's separate rights and terms.\n\n${WRAPPER_LICENSE}`
      : WRAPPER_LICENSE,
    NOTICE: `The wrapper is MIT-licensed. The remote service is subject to its provider's terms.\nIcon: ${icon.attribution}; ${icon.license}.\n${icon.sourceUrl ? `Source: ${icon.sourceUrl}\n` : ""}${icon.licenseUrl ? `Terms: ${icon.licenseUrl}\n` : ""}${separateIconRights ? "The icon is not relicensed under the wrapper's MIT license. Provider trademarks remain with their owners.\n" : ""}Package scanning covers these files, not the remote service or its future tools.\n`,
  };
  const iconBytes = Uint8Array.from(atob(icon.pngBase64), (character) => character.charCodeAt(0));
  validateSkillPresentationIcon({ path: "assets/icon.png", bytes: iconBytes });
  const files = Object.entries(textFiles).map(([path, text]) => ({
    path,
    bytes: new TextEncoder().encode(text),
    contentType: path.endsWith(".json") ? "application/json" : "text/plain",
  }));
  files.push({ path: "assets/icon.png", bytes: iconBytes, contentType: "image/png" });
  return { definition, name: packageName, files };
}
