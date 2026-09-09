// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectCapabilities } from "./capabilities";
import { inventoryPlugins, type InventoryInput } from "./inventory";

const mit = readFileSync(new URL("../../LICENSE", import.meta.url), "utf8");
const commit = "a".repeat(40);
const company = {
  repo: "example/notes",
  repositoryId: 12,
  ownerId: 10,
  commit,
  updatedAt: "2026-09-01T00:00:00Z",
  files: {
    LICENSE: mit,
    ".claude-plugin/plugin.json": JSON.stringify({
      name: "notes",
      version: "1.0.0",
      mcpServers: "./.mcp.json",
    }),
    ".mcp.json": '{"mcpServers":{"notes":{"type":"http","url":"https://example.com/mcp"}}}',
  },
};
const wrapper = {
  ...company,
  repo: "cursor/plugins",
  repositoryId: 22,
  ownerId: 20,
  files: {
    ".cursor-plugin/marketplace.json": JSON.stringify({
      plugins: [{ name: "notes", source: "notes" }],
    }),
    "notes/LICENSE": mit,
    "notes/.cursor-plugin/plugin.json": JSON.stringify({
      name: "notes",
      author: { name: "Example" },
      mcpServers: "./.mcp.json",
      category: "productivity",
    }),
    "notes/.mcp.json": company.files[".mcp.json"],
  },
};
const input = (): InventoryInput => ({
  snapshots: [structuredClone(wrapper), structuredClone(company)],
  manifest: {
    version: 1,
    registries: [{ registry: "cursor", repo: "cursor/plugins", ref: "main" }],
    sources: [
      {
        integration: "example",
        job: "notes",
        repo: "cursor/plugins",
        path: "notes",
        ref: "main",
        publisher: "cursor",
        authorship: "registry",
        format: "cursor",
        registry: "cursor",
        repositoryId: 22,
        ownerId: 20,
        ownershipEvidence: "https://github.com/cursor/plugins",
        categories: ["tools"],
      },
      {
        integration: "example",
        job: "notes",
        repo: "example/notes",
        path: "",
        ref: "main",
        publisher: "example",
        authorship: "company",
        format: "claude",
        repositoryId: 12,
        ownerId: 10,
        ownershipEvidence: "https://example.com/developers/plugins",
        categories: ["tools"],
      },
    ],
    openclaw: [],
  },
  catalog: [],
});

describe("curated plugin inventory", () => {
  it("withholds a bundle containing only plural skills.md files", async () => {
    const data = input();
    data.snapshots[1].files = {
      LICENSE: mit,
      ".claude-plugin/plugin.json": JSON.stringify({ name: "notes" }),
      "skills/notes/skills.md": "# Notes\nRead notes.",
    };
    const candidate = (await inventoryPlugins(data)).candidates[1];
    expect(candidate.status).toBe("blocked");
    expect(candidate.capabilities.runnable).not.toContain("skills");
  });
  it("rejects a later conflicting SPDX declaration in an otherwise MIT subtree", async () => {
    const data = input();
    data.snapshots[1].files["notice.txt"] =
      "SPDX-License-Identifier: MIT\nSPDX-License-Identifier: GPL-3.0-only\n";
    expect((await inventoryPlugins(data)).candidates[1].status).toBe("blocked");
  });
  it("does not request licensing permission for an existing OpenClaw equivalent", async () => {
    const data = input();
    data.snapshots[1].files.LICENSE = "All rights reserved";
    data.manifest.openclaw = [
      {
        integration: "example",
        job: "notes",
        bundledId: "notes",
        evidence: "https://github.com/openclaw/openclaw",
      },
    ];
    expect((await inventoryPlugins(data)).permissionNeeded).toHaveLength(0);
  });
  it("reports an unsafe registry entry without hiding the valid candidates", async () => {
    const data = input();
    data.snapshots[0].files[".cursor-plugin/marketplace.json"] = JSON.stringify({
      plugins: [
        { name: "unsafe", source: "../escape" },
        { name: "notes", source: "notes" },
      ],
    });
    const report = await inventoryPlugins(data);
    expect(report.candidates.find((c) => c.name === "unsafe")).toMatchObject({
      status: "blocked",
      reasons: ["Unsafe registry source path"],
    });
    expect(report.candidates.filter((c) => c.status === "selected")).toHaveLength(1);
  });
  it("reports the verified company source as canonical without trusting the wrapper's author label", async () => {
    const report = await inventoryPlugins(input());
    expect(
      report.candidates.map((c) => ({ repo: c.repo, status: c.status, publisher: c.publisher })),
    ).toEqual([
      { repo: "cursor/plugins", status: "superseded", publisher: "cursor" },
      { repo: "example/notes", status: "selected", publisher: "example" },
    ]);
    expect(report.candidates[1]).toMatchObject({
      commit,
      categories: ["tools"],
      license: { status: "eligible" },
      capabilities: { runnable: ["mcpServers"], omitted: [] },
    });
  });
  it("suppresses imports when a bundled OpenClaw equivalent exists and reports the catalog gap", async () => {
    const data = input();
    data.manifest.openclaw = [
      {
        integration: "example",
        job: "notes",
        bundledId: "notes",
        package: "@openclaw/notes",
        evidence: "https://github.com/openclaw/openclaw",
      },
    ];
    const report = await inventoryPlugins(data);
    expect(report.candidates.every((c) => c.status === "existing-openclaw")).toBe(true);
    expect(report.parityGaps).toHaveLength(1);
  });
  it("keeps a distinct primary job while suppressing same-job wrappers", async () => {
    const data = input();
    data.manifest.sources[0].job = "meeting-notes";
    expect(
      (await inventoryPlugins(data)).candidates.filter((c) => c.status === "selected"),
    ).toHaveLength(2);
  });
  it("blocks repository transfer even when author metadata and license are unchanged", async () => {
    const data = input();
    data.snapshots[1] = { ...company, ownerId: 999 };
    const report = await inventoryPlugins(data);
    expect(report.candidates[1]).toMatchObject({
      status: "blocked",
      reasons: ["Verified repository/owner identity changed"],
    });
  });
  it("does not grant a bundle-wide license from licenses in individual skill folders", async () => {
    const data = input();
    data.snapshots[1] = {
      ...company,
      files: {
        ".claude-plugin/plugin.json": company.files[".claude-plugin/plugin.json"],
        "skills/notes/LICENSE": mit,
      },
    };
    expect((await inventoryPlugins(data)).candidates[1].license?.status).toBe("blocked");
  });
  it("accepts an explicit plugin-local MIT grant under a differently licensed registry", async () => {
    const data = input();
    data.snapshots[0] = {
      ...wrapper,
      files: { ...wrapper.files, LICENSE: "Apache License, Version 2.0" },
    };
    expect((await inventoryPlugins(data)).candidates[0].license?.status).toBe("eligible");
  });
  it.each([
    ["missing", undefined],
    ["partial", "MIT License\nCopyright 2026 Example\nPermission is hereby granted"],
    ["custom", mit + "\nUse is restricted to personal projects."],
  ])("withholds %s license evidence", async (_name, license) => {
    const data = input();
    const files: Record<string, string> = { ...company.files };
    if (license) files.LICENSE = license;
    else delete files.LICENSE;
    data.snapshots[1] = { ...company, files };
    expect((await inventoryPlugins(data)).candidates[1].status).toBe("blocked");
  });
  it("rejects a contradictory nested license and preserves ancestor notices", async () => {
    const data = input();
    data.snapshots[1] = {
      ...company,
      files: {
        ...company.files,
        "skills/private/LICENSE": "All rights reserved",
        "skills/private/SKILL.md": "Private instructions",
        NOTICE: "Example attribution",
      },
    };
    const candidate = (await inventoryPlugins(data)).candidates[1];
    expect(candidate.status).toBe("blocked");
    expect(candidate.license?.notices).toContain("NOTICE");
  });
  it("keeps package-owned categories authoritative", async () => {
    const data = input();
    data.snapshots[1] = {
      ...company,
      files: {
        ...company.files,
        "openclaw.plugin.json": JSON.stringify({
          id: "notes",
          categories: ["memory"],
          skills: ["skills"],
        }),
      },
    };
    expect((await inventoryPlugins(data)).candidates[1].categories).toEqual(["memory"]);
  });
  it("deduplicates the same exact source discovered in two registries", async () => {
    const data = input();
    data.manifest.registries.push({ registry: "claude", repo: "anthropics/plugins", ref: "main" });
    data.snapshots.push({
      ...company,
      repo: "anthropics/plugins",
      files: {
        ".claude-plugin/marketplace.json": JSON.stringify({
          plugins: [{ name: "notes", source: { source: "github", repo: "example/notes" } }],
        }),
      },
    });
    const selected = (await inventoryPlugins(data)).candidates.filter(
      (c) => c.status === "selected",
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].repo).toBe("example/notes");
  });
  it("prefers runnable capability coverage over registry branding", async () => {
    const data = input();
    data.manifest.sources[1] = {
      ...data.manifest.sources[1],
      authorship: "registry",
      registry: "openai",
      publisher: "openai",
    };
    data.snapshots[1] = {
      ...company,
      files: { ...company.files, "skills/notes/SKILL.md": "# Notes" },
    };
    expect((await inventoryPlugins(data)).candidates[1].status).toBe("selected");
  });
  it("changes the source hash when an inherited license or notice changes", async () => {
    const data = input();
    data.snapshots[0] = { ...wrapper, files: { ...wrapper.files, NOTICE: "First notice" } };
    const before = (await inventoryPlugins(data)).candidates[0].contentHash;
    data.snapshots[0].files.NOTICE = "Second notice";
    expect((await inventoryPlugins(data)).candidates[0].contentHash).not.toBe(before);
  });
  it("isolates malformed uncurated plugin JSON without losing valid candidates", async () => {
    const data = input();
    data.snapshots[0].files = {
      ...wrapper.files,
      ".cursor-plugin/marketplace.json": JSON.stringify({
        plugins: [
          { name: "notes", source: "notes" },
          { name: "broken", source: "broken" },
        ],
      }),
      "broken/.cursor-plugin/plugin.json": "{",
    };
    const report = await inventoryPlugins(data);
    expect(report.candidates.find((c) => c.name === "broken")?.status).toBe("blocked");
    expect(report.candidates.find((c) => c.repo === "example/notes")?.status).toBe("selected");
  });
  it.each(["{}", "{"])("withholds a missing or malformed plugin identity: %s", async (manifest) => {
    const data = input();
    data.snapshots[1] = {
      ...company,
      files: { ...company.files, ".claude-plugin/plugin.json": manifest },
    };
    expect((await inventoryPlugins(data)).candidates[1].status).toBe("blocked");
  });
  it.each([
    "{",
    "{}",
    '{"mcpServers":{"notes":{}}}',
    '{"mcpServers":{"notes":{"url":"https://"}}}',
    '{"mcpServers":{"notes":{"url":"http://[invalid"}}}',
  ])("does not rank malformed or empty MCP definitions as runnable: %s", async (mcp) => {
    const data = input();
    data.snapshots[1] = { ...company, files: { ...company.files, ".mcp.json": mcp } };
    const candidate = (await inventoryPlugins(data)).candidates[1];
    expect(candidate.status).toBe("blocked");
    expect(candidate.capabilities.runnable).not.toContain("mcpServers");
  });
  it("points at the actual bundled target when the published package is missing", async () => {
    const data = input();
    data.manifest.openclaw = [
      {
        integration: "example",
        job: "notes",
        package: "@openclaw/notes",
        bundledId: "notes",
        evidence: "https://github.com/openclaw/openclaw",
      },
    ];
    expect((await inventoryPlugins(data)).candidates[0].canonical).toBe("notes");
  });
  it("rejects conflicting OpenClaw canonical identities", async () => {
    const data = input();
    data.manifest.openclaw = [
      {
        integration: "example",
        job: "notes",
        bundledId: "notes",
        evidence: "https://github.com/openclaw/openclaw",
      },
      {
        integration: "example",
        job: "notes",
        bundledId: "different",
        evidence: "https://github.com/openclaw/openclaw",
      },
    ];
    await expect(inventoryPlugins(data)).rejects.toThrow("Duplicate OpenClaw identity");
  });
});

it.each(["claude", "cursor", "codex"])(
  "loads only the runtime's implicit MCP path for %s",
  (format) => {
    const mcp = company.files[".mcp.json"];
    expect(inspectCapabilities({ "mcp.json": mcp }, {}, format).runnable).not.toContain(
      "mcpServers",
    );
    expect(inspectCapabilities({ ".mcp.json": mcp }, {}, format).runnable).toContain("mcpServers");
    expect(
      inspectCapabilities({ "mcp.json": mcp }, { mcpServers: "mcp.json" }, format).runnable,
    ).toContain("mcpServers");
  },
);
it("loads Agent Plugins' implicit mcp.json", () => {
  expect(
    inspectCapabilities({ "mcp.json": company.files[".mcp.json"] }, {}, "agent").runnable,
  ).toContain("mcpServers");
});
