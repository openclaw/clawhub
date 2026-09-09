// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { CuratedSource, Snapshot } from "./contract";
import { preparePlugin } from "./prepare";
const license = readFileSync(new URL("../../LICENSE", import.meta.url), "utf8");
function fixture(): { source: CuratedSource; snapshot: Snapshot } {
  return {
    source: {
      integration: "intercom",
      job: "support",
      repo: "cursor/plugins",
      path: "plugins/intercom",
      ref: "main",
      publisher: "cursor",
      authorship: "registry",
      registry: "cursor",
      format: "cursor",
      repositoryId: 1,
      ownerId: 2,
      ownershipEvidence: "https://github.com/cursor/plugins",
      categories: ["tools"],
    },
    snapshot: {
      repo: "cursor/plugins",
      repositoryId: 1,
      ownerId: 2,
      commit: "a".repeat(40),
      updatedAt: "2026-09-01T00:00:00Z",
      files: {
        LICENSE: license,
        NOTICE: "Required attribution",
        "plugins/intercom/.cursor-plugin/plugin.json": JSON.stringify({
          name: "intercom",
          version: "1.0.0",
          author: { name: "Cursor" },
          mcpServers: "./mcp.json",
          rules: "./rules",
        }),
        "plugins/intercom/mcp.json":
          '{"mcpServers":{"intercom":{"url":"https://mcp.intercom.com/mcp"}}}',
        "plugins/intercom/rules/general.mdc": "unsupported",
      },
    },
  };
}
it("preserves source licenses and attribution while producing a normal Cursor bundle", async () => {
  const result = await preparePlugin(fixture());

  expect(result.name).toBe("@cursor/intercom-support");
  expect(result.files["LICENSE"]).toEqual(Buffer.from(license));
  expect(result.files["NOTICE"]).toEqual(Buffer.from("Required attribution"));
  expect(result.files["rules/general.mdc"]).toBeUndefined();
  expect(JSON.parse(Buffer.from(result.files["openclaw.plugin.json"]).toString())).toMatchObject({
    id: "intercom-support",
    categories: ["tools"],
  });
  expect(JSON.parse(Buffer.from(result.files["CLAWHUB_SOURCE.json"]).toString())).toMatchObject({
    repo: "cursor/plugins",
    commit: "a".repeat(40),
    authorship: "registry",
    omittedCapabilities: ["rules"],
    author: { name: "Cursor" },
  });
});

it("preserves binary assets and required notices beneath omitted capabilities", async () => {
  const input = fixture();
  const path = "plugins/intercom/rules/NOTICE";
  input.snapshot.files[path] = "Retain this attribution";
  input.snapshot.files["plugins/intercom/icon.png"] = "binary";
  input.snapshot.fileBytes = {
    "plugins/intercom/icon.png": new Uint8Array([0, 255, 137, 80, 78, 71]),
  };
  const result = await preparePlugin(input);
  expect(result.files["rules/NOTICE"]).toEqual(Buffer.from("Retain this attribution"));
  expect(result.files["icon.png"]).toEqual(input.snapshot.fileBytes["plugins/intercom/icon.png"]);
});
it("removes competing format markers so runtime detection honors the selected format", async () => {
  const input = fixture();
  input.snapshot.files["plugins/intercom/.codex-plugin/plugin.json"] = '{"name":"competing"}';
  const result = await preparePlugin(input);
  expect(result.files[".codex-plugin/plugin.json"]).toBeUndefined();
  expect(result.files[".cursor-plugin/plugin.json"]).toBeDefined();
  expect((await preparePlugin(input)).artifactHash).toBe(result.artifactHash);
});
