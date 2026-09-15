type Json = Record<string, unknown>;
const roots: Record<string, string[]> = {
  skills: ["skills"],
  mcpServers: [".mcp.json", "mcp.json"],
  settings: ["settings.json"],
  lspServers: [".lsp.json"],
  commands: ["commands"],
  agents: ["agents", ".cursor/agents"],
  hooks: ["hooks/hooks.json"],
  rules: ["rules", ".cursor/rules"],
  outputStyles: ["output-styles"],
  apps: [".app.json"],
};
function isRecord(value: unknown): value is Json {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}
function validConfig(cap: string, value: unknown): boolean {
  if (!isRecord(value) || !Object.keys(value).length) return false;
  if (cap === "settings") return true;
  if (cap === "hooks") return isRecord(value.hooks) && Object.keys(value.hooks).length > 0;
  const servers = value[cap] ?? value.servers ?? value;
  if (!isRecord(servers) || !Object.keys(servers).length) return false;
  return Object.values(servers).every(
    (server) =>
      isRecord(server) &&
      ((typeof server.command === "string" && Boolean(server.command.trim())) ||
        (cap === "mcpServers" && typeof server.url === "string" && isHttpUrl(server.url))),
  );
}
export function inspectCapabilities(files: Record<string, string>, manifest: Json, format: string) {
  // Match OpenClaw 2026.9.3's bundle-manifest/bundle-mcp loaders, not Cursor's
  // broader schema: no root SKILL.md fallback or inline MCP array objects;
  // Cursor/Claude MCP defaults are merged with explicitly declared paths.
  const runnable: string[] = [];
  const omitted: string[] = [];
  const errors: string[] = [];
  const has = (root: string) =>
    Object.keys(files).some((p) => p === root || p.startsWith(`${root}/`));
  for (const [cap, defaults] of Object.entries(roots)) {
    const raw = manifest[cap];
    const declared = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
    // The shipped loader uses mcp.json for Agent Plugins and .mcp.json for
    // Cursor/Claude/Codex. Other filenames must be explicitly declared.
    const implicit =
      cap === "mcpServers" ? [format === "agent" ? "mcp.json" : ".mcp.json"] : defaults;
    const paths = new Set(implicit.filter(has));
    for (const path of declared) {
      if (
        typeof path !== "string" ||
        path.startsWith("/") ||
        path.includes("\\") ||
        path.split("/").includes("..")
      ) {
        errors.push(`Unsafe ${cap} path`);
        continue;
      }
      const normalized = path.replace(/^\.\//, "").replace(/\/$/, "");
      if (!normalized || !has(normalized)) {
        errors.push(`Missing ${cap} path: ${path}`);
        continue;
      }
      paths.add(normalized);
    }
    const inline = isRecord(raw) && Object.keys(raw).length > 0;
    if (!inline && !paths.size) continue;
    // This is the approved v1 import contract, not a promise that an arbitrary
    // source has passed the separate OpenClaw installation acceptance seam.
    const supported =
      ["skills", "mcpServers", "settings"].includes(cap) ||
      (["commands", "lspServers"].includes(cap) && format === "claude") ||
      (cap === "hooks" && (format === "codex" || format === "openclaw"));
    if (!supported) {
      omitted.push(cap);
      continue;
    }
    let valid = false;
    if (cap === "skills" || cap === "commands") {
      valid = [...paths].some((root) =>
        Object.entries(files).some(
          ([path, text]) =>
            (path === root || path.startsWith(`${root}/`)) &&
            (cap === "skills" ? /(?:^|\/)SKILL\.md$/.test(path) : path.endsWith(".md")) &&
            Boolean(text.trim()),
        ),
      );
    } else {
      const configs: unknown[] = inline ? [raw] : [];
      for (const path of paths) {
        try {
          configs.push(JSON.parse(files[path]));
        } catch {
          errors.push(`Invalid ${cap} JSON: ${path}`);
        }
      }
      valid = configs.length > 0 && configs.every((config) => validConfig(cap, config));
    }
    if (valid) runnable.push(cap);
    else errors.push(`Invalid or empty ${cap} capability`);
  }
  return { runnable: runnable.sort(), omitted: omitted.sort(), errors };
}
