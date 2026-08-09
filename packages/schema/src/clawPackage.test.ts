import { describe, expect, it } from "vitest";
import {
  findClawPackagePathHierarchyCollision,
  validateClawPackageContents,
} from "./clawPackage.js";

const manifest = {
  schemaVersion: 1,
  agent: { id: "github-triage", name: "GitHub Triage", description: "Reviews issues." },
  workspace: {
    bootstrapFiles: {},
    files: [{ source: "workspace/reference.md", path: "reference.md" }],
  },
  packages: [{ kind: "skill", source: "clawhub", ref: "@acme/triage", version: "1.2.0" }],
  mcpServers: {},
  cronJobs: [],
};
const openClawProfile = [
  "schemaVersion: 1",
  "agent:",
  "  groupChat:",
  "    mentionPatterns: ['@triage']",
  "  sandbox: { mode: non-main, scope: agent, workspaceAccess: rw }",
  "  tools:",
  "    profile: coding",
  "    alsoAllow: [cron]",
  "    deny: [gateway]",
  "    fs: { workspaceOnly: true }",
  "  memory:",
  "    search:",
  "      enabled: true",
  "      rememberAcrossConversations: true",
  "      sources: [memory, sessions]",
  "  heartbeat:",
  "    every: 30m",
  "    activeHours: { start: '09:00', end: '24:00', timezone: America/Los_Angeles }",
  "    lightContext: true",
  "    isolatedSession: false",
  "    timeoutSeconds: 30",
  "  humanDelay: { mode: custom, minMs: 0, maxMs: 2000 }",
].join("\n");

function packageJson(claw = "CLAW.md") {
  return {
    name: "@acme/github-triage",
    version: "1.0.0",
    openclaw: { claw },
  };
}

function files(manifestText = `---\n${JSON.stringify(manifest)}\n---\n`) {
  return [
    { path: "package.json", text: JSON.stringify(packageJson()) },
    { path: "CLAW.md", text: manifestText },
    { path: "workspace/SOUL.md", text: "Be precise.\n" },
    { path: "workspace/reference.md", text: "Reference\n" },
  ];
}

describe("validateClawPackageContents", () => {
  it("finds hierarchy collisions even when another path sorts between them", () => {
    expect(findClawPackagePathHierarchyCollision(["a", "a-0", "a/child"])).toEqual({
      ancestor: "a",
      descendant: "a/child",
    });
  });

  it("finds hierarchy collisions after full Unicode case folding", () => {
    expect(findClawPackagePathHierarchyCollision(["Straße", "STRASSE/child"])).toEqual({
      ancestor: "Straße",
      descendant: "STRASSE/child",
    });
  });

  it("validates frontmatter-only CLAW.md and derives its safe summary", () => {
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
        hasClawMarkdownBody: false,
        summary: expect.objectContaining({
          agent: {
            id: "github-triage",
            name: "GitHub Triage",
            description: "Reviews issues.",
          },
          packages: { skillCount: 1, pluginCount: 0 },
          workspace: { bootstrapFiles: [], fileCount: 1 },
        }),
      }),
    });
  });

  it("treats a non-empty CLAW.md body as the portable SOUL.md source", () => {
    const bodyManifest = {
      ...manifest,
      workspace: { files: manifest.workspace.files },
    };
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(`---\n${JSON.stringify(bodyManifest)}\n---\nBe precise.\n`).filter(
        (file) => file.path !== "workspace/SOUL.md",
      ),
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        hasClawMarkdownBody: true,
        summary: expect.objectContaining({
          workspace: { bootstrapFiles: ["SOUL.md"], fileCount: 1 },
        }),
      }),
    });
    if (result.ok) expect(result.value).not.toHaveProperty("clawMarkdownBody");
  });

  it.each([
    [
      "bootstrap file",
      {
        ...manifest,
        workspace: {
          ...manifest.workspace,
          bootstrapFiles: { "SOUL.md": { source: "workspace/SOUL.md" } },
        },
      },
    ],
    [
      "workspace file",
      {
        ...manifest,
        workspace: {
          files: [...manifest.workspace.files, { source: "workspace/SOUL.md", path: "soul.md" }],
        },
      },
    ],
  ])("rejects a CLAW.md body combined with an explicit SOUL.md %s", (_label, value) => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(`---\n${JSON.stringify(value)}\n---\nBe precise.\n`),
    });

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "claw_body_soul_conflict" })],
    });
  });

  it.each(["SOUL.md/child", "soul.MD/child", "SOUL.md/cafe\u0301"])(
    "rejects an implicit SOUL.md hierarchy collision at %s",
    (path) => {
      const result = validateClawPackageContents({
        packageName: "@acme/github-triage",
        version: "1.0.0",
        packageJson: packageJson(),
        files: files(
          `---\n${JSON.stringify({
            ...manifest,
            workspace: {
              files: [...manifest.workspace.files, { source: "workspace/SOUL.md", path }],
            },
          })}\n---\nBe precise.\n`,
        ),
      });

      expect(result).toEqual({
        ok: false,
        issues: [expect.objectContaining({ code: "claw_body_soul_conflict" })],
      });
    },
  );

  it("accepts one UTF-8 BOM before CLAW.md frontmatter", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(`\uFEFF---\n${JSON.stringify(manifest)}\n---\n`),
    });

    expect(result.ok).toBe(true);
  });

  it.each(["", "\n \t\n"])("accepts an empty CLAW.md body without implicit SOUL.md", (body) => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(`---\n${JSON.stringify(manifest)}\n---\n${body}`),
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        hasClawMarkdownBody: false,
        summary: expect.objectContaining({
          workspace: expect.objectContaining({ bootstrapFiles: [] }),
        }),
      }),
    });
  });

  it("rejects a CLAW.md envelope larger than 1 MiB", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(`---\n${JSON.stringify(manifest)}\n---\n${"x".repeat(1024 * 1024)}`),
    });

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "claw_manifest_too_large", path: "CLAW.md" })],
    });
  });

  it("validates a package-local OpenClaw profile without returning it", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [
        ...files(`---\n${JSON.stringify(manifest)}\n---\n# Prompt\n`),
        { path: "profiles/openclaw.yml", text: openClawProfile },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toHaveProperty("profile");
      expect(result.value.manifest.agent).toEqual(manifest.agent);
    }
  });

  it("accepts an applying harness profile that ClawHub does not yet know", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [
        ...files(`---\n${JSON.stringify(manifest)}\n---\n# Prompt\n`),
        {
          path: "profiles/openclaw.yml",
          text: "schemaVersion: 1\nagent:\n  tools:\n    profile: future-profile",
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).not.toHaveProperty("profile");
  });

  it.each([
    "profiles/OPENCLAW.yml",
    "profiles/openclaw.yaml",
    "Profiles/openclaw.yml",
    "profiles/openclaw.json",
    "profiles/codex/settings.yml",
  ])("requires conventional harness profile path %s", (profilePath) => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [...files(), { path: profilePath, text: openClawProfile }],
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({ code: "invalid_harness_profile_path", path: profilePath }),
      ],
    });
  });

  it("requires agent settings in the conventional OpenClaw profile", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [
        ...files(),
        {
          path: "profiles/openclaw.yml",
          text: [
            "schemaVersion: 1",
            "extensions:",
            "  - id: issue-tools",
            "    kind: plugin",
            "    format: openclaw",
            "    source: clawhub",
            "    ref: '@acme/issue-tools'",
            "    version: 2.3.4",
          ].join("\n"),
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "invalid_openclaw_profile",
          path: "profiles/openclaw.yml.agent",
        }),
      ],
    });
  });

  it.each([
    ["duplicate id", "id: issue-tools", "id: issue-tools"],
    ["duplicate ref", "id: issue-tools", "id: other-tools"],
  ])("rejects OpenClaw extension %s", (_label, firstId, secondId) => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [
        ...files(),
        {
          path: "profiles/openclaw.yml",
          text: [
            "schemaVersion: 1",
            "extensions:",
            `  - ${firstId}`,
            "    kind: plugin",
            "    format: openclaw",
            "    source: clawhub",
            "    ref: '@acme/issue-tools'",
            "    version: 2.3.4",
            `  - ${secondId}`,
            "    kind: plugin",
            "    format: codex",
            "    source: clawhub",
            "    ref: '@acme/issue-tools'",
            "    version: 2.3.5",
          ].join("\n"),
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "invalid_openclaw_profile" }),
      ]),
    });
  });

  it("accepts but does not interpret a foreign conventional profile", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [...files(), { path: "profiles/codex.yml", text: "version: 27\nfeatures: [future]" }],
    });

    expect(result.ok).toBe(true);
  });

  it.each([
    ["malformed", "version: ["],
    ["non-mapping", "- one\n- two"],
    ["non-finite scalar", "limits: [.inf, .nan]"],
    ["alias", "base: &base {}\ncopy: *base"],
  ])("rejects %s foreign harness profile YAML", (_label, profileText) => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [...files(), { path: "profiles/codex.yml", text: profileText }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toMatch(/harness_profile/);
  });

  it("accepts a nonempty UTF-8 package-root BOOTSTRAP.md", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [...files(), { path: "BOOTSTRAP.md", text: "Interview the user once.\n" }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.summary.workspace.bootstrapFiles).toEqual(["BOOTSTRAP.md"]);
    }
  });

  it.each(["bootstrap.md", "Bootstrap.md"])(
    "rejects noncanonical package-root bootstrap path %s",
    (bootstrapPath) => {
      const result = validateClawPackageContents({
        packageName: "@acme/github-triage",
        version: "1.0.0",
        packageJson: packageJson(),
        files: [...files(), { path: bootstrapPath, text: "Unvalidated instructions.\n" }],
      });

      expect(result).toEqual({
        ok: false,
        issues: [expect.objectContaining({ code: "invalid_package_path", path: bootstrapPath })],
      });
    },
  );

  it.each([
    ["non-UTF-8", undefined, "package_bootstrap_invalid"],
    ["empty", "  \n", "package_bootstrap_empty"],
    ["oversized", "x".repeat(2 * 1024 * 1024 + 1), "package_bootstrap_too_large"],
  ])("rejects %s package-root bootstrap content", (_label, bootstrapText, code) => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [...files(), { path: "BOOTSTRAP.md", text: bootstrapText }],
    });

    expect(result).toEqual({ ok: false, issues: [expect.objectContaining({ code })] });
  });

  it("rejects the retired profile pointer with migration guidance", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(
        `---\n${JSON.stringify({ ...manifest, metadata: { "openclaw.config": "profiles/openclaw.yml" } })}\n---\n`,
      ),
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "invalid_claw_manifest",
          path: "$.metadata.openclaw.config",
          message: expect.stringContaining("move the profile to profiles/openclaw.yml"),
        }),
      ],
    });
  });

  it("enforces the shared OpenClaw host environment policy through package validation", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(
        `---\n${JSON.stringify({
          ...manifest,
          mcpServers: {
            unsafe: { command: "server", env: { CPP: "${CPP}" } },
          },
        })}\n---\n# Prompt\n`,
      ),
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "invalid_claw_manifest",
          path: "$.mcpServers.unsafe.env.CPP",
        }),
      ],
    });
  });

  it.each([
    ["malformed YAML", "schemaVersion: [", "invalid_openclaw_profile"],
    ["duplicate keys", "schemaVersion: 1\nschemaVersion: 1\nagent: {}", "invalid_openclaw_profile"],
    [
      "aliases",
      "schemaVersion: 1\nagent: &agent {}\ncopy: *agent",
      "unsupported_openclaw_profile_yaml_feature",
    ],
    ["anchors", "schemaVersion: 1\nagent: &agent {}", "unsupported_openclaw_profile_yaml_feature"],
    [
      "merge keys",
      "schemaVersion: 1\nagent:\n  <<: { tools: {} }",
      "unsupported_openclaw_profile_yaml_feature",
    ],
    [
      "explicit tags",
      "schemaVersion: 1\nagent: !!map {}",
      "unsupported_openclaw_profile_yaml_feature",
    ],
    [
      "non-string mapping keys",
      "schemaVersion: 1\nagent:\n  ? [tools]\n  : {}",
      "unsupported_openclaw_profile_yaml_feature",
    ],
  ])("rejects OpenClaw profile %s", (_label, text, code) => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [
        ...files(`---\n${JSON.stringify(manifest)}\n---\n# Prompt\n`),
        { path: "profiles/openclaw.yml", text },
      ],
    });

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code })],
    });
  });

  it("rejects an oversized OpenClaw profile", () => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [
        ...files(`---\n${JSON.stringify(manifest)}\n---\n# Prompt\n`),
        { path: "profiles/openclaw.yml", text: `#${"x".repeat(256 * 1024)}` },
      ],
    });

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "openclaw_profile_too_large" })],
    });
  });

  it.each([
    ["unknown version", "schemaVersion: 2\nagent: {}"],
    ["unknown field", "schemaVersion: 1\nagent:\n  model: gpt-5"],
    [
      "unsupported heartbeat field",
      "schemaVersion: 1\nagent:\n  heartbeat:\n    skipWhenBusy: true",
    ],
    [
      "workspaceOnly false",
      "schemaVersion: 1\nagent:\n  tools:\n    fs:\n      workspaceOnly: false",
    ],
    [
      "allow conflict",
      "schemaVersion: 1\nagent:\n  tools:\n    allow: [read]\n    alsoAllow: [write]",
    ],
    [
      "sessions without consent",
      "schemaVersion: 1\nagent:\n  memory:\n    search:\n      sources: [sessions]",
    ],
  ])("rejects OpenClaw profile with %s", (_label, text) => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [
        ...files(`---\n${JSON.stringify(manifest)}\n---\n# Prompt\n`),
        { path: "profiles/openclaw.yml", text },
      ],
    });

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "invalid_openclaw_profile" })],
    });
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
    const jsonManifest = {
      ...manifest,
      workspace: {
        ...manifest.workspace,
        bootstrapFiles: { "SOUL.md": { source: "workspace/SOUL.md" } },
      },
    };
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson("openclaw.claw.json"),
      files: [
        ...files().filter((file) => file.path !== "CLAW.md"),
        { path: "openclaw.claw.json", text: JSON.stringify(jsonManifest) },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).not.toHaveProperty("implicitWorkspaceFile");
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

  it.each([
    ["ancestor first", [{ path: "workspace", text: "file" }, ...files()]],
    ["descendant first", [...files(), { path: "workspace", text: "file" }]],
    ["case-folded ancestor", [...files(), { path: "WORKSPACE", text: "file" }]],
    [
      "Unicode-normalized ancestor",
      [
        ...files(),
        { path: "cafe\u0301/reference.md", text: "child" },
        { path: "caf\u00e9", text: "file" },
      ],
    ],
  ])("rejects package file/ancestor collisions with %s", (_label, packageFiles) => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: packageFiles,
    });

    expect(result).toEqual({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "portable_path_hierarchy_collision" }),
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

  it.each([
    ["DEL", "\u007f"],
    ["C1", "\u0085"],
  ])("rejects %s control characters in package paths", (_label, controlCharacter) => {
    const result = validateClawPackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [...files(), { path: `workspace/a${controlCharacter}.md`, text: "unused" }],
    });

    expect(result).toEqual({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "invalid_package_path" })]),
    });
  });

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
      files: files(`---\n${JSON.stringify(unsafe)}\n---\n# Prompt\n`),
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
