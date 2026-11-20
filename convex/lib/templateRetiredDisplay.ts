import { parseTemplateMarkdownDocument } from "clawhub-schema/templatePackage";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recognize the actual retired v1 package list, scheduler key and harness profiles.
 * The result is diagnostic input only. Never return, store or install a translated manifest. */
export function retiredTemplateDisplayInput(raw: string, path: string, files: readonly string[]) {
  const parsed = parseTemplateMarkdownDocument(raw, path);
  if ("issues" in parsed || !record(parsed.value) || parsed.value.schemaVersion !== 1) return null;
  const next = { ...parsed.value };
  const profiles = files.filter((name) => name.startsWith("profiles/"));
  if (profiles.some((name) => !/^profiles\/[a-z][a-z0-9_-]{0,63}\.yml$/.test(name))) return null;
  let retired = profiles.length > 0;
  if (Object.hasOwn(next, "packages")) {
    if (!Array.isArray(next.packages)) return null;
    for (const row of next.packages as unknown[]) {
      if (
        !record(row) ||
        (row.kind !== "skill" && row.kind !== "plugin") ||
        row.source !== "clawhub" ||
        Object.keys(row).some((key) => !["kind", "source", "ref", "version"].includes(key))
      )
        return null;
      const key = row.kind === "skill" ? "skills" : "plugins";
      const deps = next[key] ?? [];
      if (!Array.isArray(deps)) return null;
      deps.push({ ref: row.ref, version: row.version });
      next[key] = deps;
    }
    delete next.packages;
    retired = true;
  }
  if (Object.hasOwn(next, "cronJobs")) {
    if (!Array.isArray(next.cronJobs) || Object.hasOwn(next, "automations")) return null;
    next.automations = next.cronJobs;
    delete next.cronJobs;
    retired = true;
  }
  if (record(next.metadata) && Object.hasOwn(next.metadata, "openclaw.config")) {
    const { ["openclaw.config"]: pointer, ...rest } = next.metadata;
    if (typeof pointer !== "string" || !profiles.includes(pointer)) return null;
    next.metadata = rest;
    retired = true;
  }
  if (!retired) return null;
  return {
    text: ["---", JSON.stringify(next), "---", parsed.templateMarkdownBody ?? ""].join("\n"),
    profiles: new Set(profiles),
  };
}
