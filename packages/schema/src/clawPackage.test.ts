import { describe, expect, it } from "vitest";
import { validateClawPackageContents } from "./clawPackage.js";

const manifest = {
  schemaVersion: 1,
  agent: { id: "github-triage", name: "GitHub Triage", description: "Reviews issues." },
  workspace: {
    bootstrapFiles: { "SOUL.md": { source: "workspace/SOUL.md" } },
    files: [{ source: "workspace/reference.md", path: "reference.md" }],
  },
  packages: [{ kind: "skill", source: "clawhub", ref: "@acme/triage", version: "1.2.0" }],
  mcpServers: {},
  cronJobs: [],
};

function packageJson(claw = "CLAW.md") {
  return {
    name: "@acme/github-triage",
    version: "1.0.0",
    openclaw: { claw },
  };
}

function files(manifestText = `---\n${JSON.stringify(manifest)}\n---\n# GitHub Triage\n`) {
  return [
    { path: "package.json", text: JSON.stringify(packageJson()) },
    { path: "CLAW.md", text: manifestText },
    { path: "workspace/SOUL.md", text: "Be precise.\n" },
    { path: "workspace/reference.md", text: "Reference\n" },
  ];
}

describe("validateClawPackageContents", () => {
  it("validates CLAW.md and derives its safe summary", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(),
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        manifestPath: "CLAW.md",
        summary: expect.objectContaining({
          agent: {
            id: "github-triage",
            name: "GitHub Triage",
            description: "Reviews issues.",
          },
          packages: { skillCount: 1, pluginCount: 0 },
        }),
      }),
    });
  });

  it("accepts one UTF-8 BOM before CLAW.md frontmatter", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(`\uFEFF---\n${JSON.stringify(manifest)}\n---\n# GitHub Triage\n`),
    });

    expect(result.ok).toBe(true);
  });

  it.each([
    ["anchor", "agent: &agent { id: github-triage }"],
    ["alias", "agent: { id: &id github-triage, name: *id }"],
    ["merge key", "agent: { <<: { id: github-triage } }"],
    ["explicit tag", "agent: { id: !!str github-triage }"],
    ["non-string mapping key", "agent: { id: github-triage, true: nope }"],
  ])("rejects CLAW.md YAML %s", (_label, declaration) => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(
        [
          "---",
          "schemaVersion: 1",
          declaration,
          "workspace: {}",
          "packages: []",
          "mcpServers: {}",
          "cronJobs: []",
          "---",
        ].join("\n"),
      ),
    });

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "unsupported_claw_yaml_feature" })],
    });
  });

  it("does not treat a suffix-only filename as CLAW.md", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson("NOTCLAW.md"),
      files: [
        ...files().filter((file) => file.path !== "CLAW.md"),
        { path: "NOTCLAW.md", text: `---\n${JSON.stringify(manifest)}\n---\n` },
      ],
    });

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "invalid_claw_json" })],
    });
  });

  it("accepts the JSON compatibility manifest", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson("openclaw.claw.json"),
      files: [
        ...files().filter((file) => file.path !== "CLAW.md"),
        { path: "openclaw.claw.json", text: JSON.stringify(manifest) },
      ],
    });

    expect(result.ok).toBe(true);
  });

  it("requires package identity to match the publication", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/other",
      version: "2.0.0",
      packageJson: packageJson(),
      files: files(),
    });

    expect(result).toEqual({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "package_name_mismatch" }),
        expect.objectContaining({ code: "package_version_mismatch" }),
      ]),
    });
  });

  it.each([
    ["name", { ...packageJson(), name: " @acme/github-triage" }],
    ["version", { ...packageJson(), version: "1.0.0 " }],
    ["manifest path", packageJson(" CLAW.md")],
  ])("does not trim padded package %s into validity", (_label, metadata) => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: metadata,
      files: files(),
    });

    expect(result.ok).toBe(false);
  });

  it("rejects missing declared workspace sources", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files().filter((file) => file.path !== "workspace/reference.md"),
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "missing_workspace_source",
          path: "workspace/reference.md",
        }),
      ],
    });
  });

  it("rejects duplicate paths that collide on portable filesystems", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [...files(), { path: "claw.md", text: "duplicate" }],
    });

    expect(result).toEqual({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "duplicate_portable_path" }),
      ]),
    });
  });

  it.each(["CON", "workspace/trailing.", "workspace\\backslash.md"])(
    "rejects unsafe unreferenced package path %s",
    (path) => {
      const result = validateClawPackageContents({
        packageName: "@acme/github-triage",
        version: "1.0.0",
        packageJson: packageJson(),
        files: [...files(), { path, text: "unused" }],
      });

      expect(result).toEqual({
        ok: false,
        issues: expect.arrayContaining([expect.objectContaining({ code: "invalid_package_path" })]),
      });
    },
  );

  it("requires exact path spelling for manifests and workspace sources", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files().map((file) =>
        file.path === "CLAW.md"
          ? { ...file, path: "claw.md" }
          : file.path === "workspace/reference.md"
            ? { ...file, path: "workspace/REFERENCE.md" }
            : file,
      ),
    });

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "missing_claw_manifest" })],
    });
  });

  it("rejects resolved credentials through the shared manifest validator", () => {
    const unsafe = {
      ...manifest,
      mcpServers: { github: { command: "npx", env: { GITHUB_TOKEN: "secret" } } },
    };
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(`---\n${JSON.stringify(unsafe)}\n---\n`),
    });

    expect(result).toEqual({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_claw_manifest",
          path: "$.mcpServers.github.env.GITHUB_TOKEN",
        }),
      ]),
    });
  });
});
