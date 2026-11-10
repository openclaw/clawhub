import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  findTemplatePackagePathHierarchyCollision,
  validateTemplatePackageContents,
} from "./templatePackage.js";

const manifest = {
  schemaVersion: 1,
  agent: { id: "github-triage", name: "GitHub Triage", description: "Reviews issues." },
  workspace: {
    bootstrapFiles: {},
    files: [{ source: "workspace/reference.md", path: "reference.md" }],
  },
  skills: [{ ref: "@acme/triage", version: "1.2.0" }],
  mcpServers: {},
  automations: [],
};
const openClawProfile = [
  "schemaVersion: 1",
  "agent:",
  "  groupChat:",
  "    mentionPatterns: ['@triage']",
  "  sandbox: { mode: non-main, scope: agent, workspaceAccess: rw }",
  "  tools:",
  "    profile: minimal",
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

function packageJson(template = "CLAW.md") {
  return {
    name: "@acme/github-triage",
    version: "1.0.0",
    openclaw: { template },
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

describe("validateTemplatePackageContents", () => {
  it("validates complete bundled skill contents and derives only declared metadata", () => {
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [
        ...files(
          `---\n${JSON.stringify({ ...manifest, skills: [{ path: "skills/research" }] })}\n---\n`,
        ),
        {
          path: "skills/research/SKILL.md",
          text: "---\nname: Research\ndescription: Find approved sources.\n---\nUse the references.\n",
        },
        { path: "skills/research/references/source.md", text: "A source.\n" },
        { path: "skills/research/assets/chart.png", size: 4 },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        inventory: [
          { kind: "skill", source: "bundled", path: "skills/research", name: "Research" },
        ],
        summary: { packages: { skillCount: 1, pluginCount: 0 } },
      },
    });
  });

  it.each([
    ["missing SKILL.md", []],
    [
      "oversized binary file",
      [
        { path: "SKILL.md", text: "---\ndescription: Research sources.\n---\n" },
        { path: "assets/source.bin", size: 1024 * 1024 + 1 },
      ],
    ],
    [
      "unknown binary size",
      [
        { path: "SKILL.md", text: "---\ndescription: Research sources.\n---\n" },
        { path: "assets/source.bin" },
      ],
    ],
    [
      "excessive depth",
      [
        { path: "SKILL.md", text: "---\ndescription: Research sources.\n---\n" },
        { path: `${"d/".repeat(16)}source.bin`, size: 1 },
      ],
    ],
  ])("rejects incomplete or unbounded bundled skill contents: %s", (_label, dependencyFiles) => {
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [
        ...files(
          `---\n${JSON.stringify({ ...manifest, skills: [{ path: "skills/research" }] })}\n---\n`,
        ),
        ...dependencyFiles.map((file) => ({ ...file, path: `skills/research/${file.path}` })),
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "invalid_bundled_dependency" })],
    });
  });

  it("allows native skill fallback identity without inventing a metadata name", () => {
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [
        ...files(
          `---\n${JSON.stringify({ ...manifest, skills: [{ path: "skills/research" }] })}\n---\n`,
        ),
        { path: "skills/research/SKILL.md", text: "---\ndescription: Research sources.\n---\n" },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      value: { inventory: [{ kind: "skill", source: "bundled", path: "skills/research" }] },
    });
    if (result.ok) expect(result.value.inventory[0]).not.toHaveProperty("name");
  });

  it("rejects portable collisions between implicit bundled directories", () => {
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [
        ...files(
          `---\n${JSON.stringify({ ...manifest, skills: [{ path: "skills/research" }] })}\n---\n`,
        ),
        { path: "skills/research/SKILL.md", text: "---\ndescription: Research sources.\n---\n" },
        { path: "skills/research/Reference/a.md", text: "A" },
        { path: "skills/research/reference/b.md", text: "B" },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "invalid_bundled_dependency" })],
    });
  });

  it.each([
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
  ])("derives bundled plugin identity from %s", (marker) => {
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [
        ...files(
          `---\n${JSON.stringify({ ...manifest, plugins: [{ path: "plugins/alerts" }] })}\n---\n`,
        ),
        { path: `plugins/alerts/${marker}`, text: "{name: 'Release Alerts', version: '9.0.0'}" },
        {
          path: "plugins/alerts/skills/notes/SKILL.md",
          text: "---\nname: notes\ndescription: Notes.\n---\n",
        },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        inventory: [
          { kind: "skill", source: "clawhub", ref: "@acme/triage", version: "1.2.0" },
          { kind: "plugin", source: "bundled", path: "plugins/alerts", name: "Release Alerts" },
        ],
      },
    });
    if (result.ok) expect(result.value.inventory[1]).not.toHaveProperty("version");
  });
  it.each([true, false])(
    "validates bundled code-plugin entrypoints (present: %s)",
    (entryPresent) => {
      const result = validateTemplatePackageContents({
        packageName: "@acme/github-triage",
        version: "1.0.0",
        packageJson: packageJson(),
        files: [
          ...files(
            `---\n${JSON.stringify({ ...manifest, plugins: [{ path: "plugins/alerts" }] })}\n---\n`,
          ),
          {
            path: "plugins/alerts/openclaw.plugin.json",
            text: "{id: 'alerts', name: 'Release Alerts', configSchema: {type: 'object'}}",
          },
          {
            path: "plugins/alerts/package.json",
            text: JSON.stringify({
              name: "@acme/alerts",
              version: "9.0.0",
              openclaw: { extensions: ["./index.js"] },
            }),
          },
          ...(entryPresent
            ? [{ path: "plugins/alerts/index.js", text: "export default {};" }]
            : []),
        ],
      });
      expect(result.ok).toBe(entryPresent);
      if (result.ok)
        expect(result.value.inventory[1]).toEqual({
          kind: "plugin",
          source: "bundled",
          path: "plugins/alerts",
          name: "Release Alerts",
        });
      else expect(result.issues[0].message).toContain("missing from the package");
    },
  );

  it.each(["automations"])("preserves scheduled work from the %s manifest key", (key) => {
    const { automations: _, ...portable } = manifest;
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(
        `---\n${JSON.stringify({
          ...portable,
          [key]: [
            {
              id: "daily-triage",
              schedule: { cron: "0 8 * * *", timezone: "UTC" },
              session: "isolated",
              message: "Triage new issues.",
            },
          ],
        })}\n---\n`,
      ),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.manifest.automations?.[0]?.id).toBe("daily-triage");
    expect(result.value.manifest).not.toHaveProperty("cronJobs");
    expect(result.value.summary.cronJobCount).toBe(1);
  });

  it("rejects packages that declare both automation keys", () => {
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(`---\n${JSON.stringify({ ...manifest, cronJobs: [] })}\n---\n`),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "$.cronJobs" })]),
    );
  });

  it("finds hierarchy collisions even when another path sorts between them", () => {
    expect(findTemplatePackagePathHierarchyCollision(["a", "a-0", "a/child"])).toEqual({
      ancestor: "a",
      descendant: "a/child",
    });
  });

  it("finds hierarchy collisions after full Unicode case folding", () => {
    expect(findTemplatePackagePathHierarchyCollision(["Straße", "STRASSE/child"])).toEqual({
      ancestor: "Straße",
      descendant: "STRASSE/child",
    });
  });

  it("validates frontmatter-only CLAW.md and derives its safe summary", () => {
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(),
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        manifestPath: "CLAW.md",
        hasTemplateMarkdownBody: false,
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

  it("preserves declared categories from CLAW.md frontmatter", () => {
    const categorized = { ...manifest, categories: ["engineering", "productivity"] };
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(`---\n${JSON.stringify(categorized)}\n---\n`),
    });

    expect(result).toMatchObject({
      ok: true,
      value: { manifest: { categories: ["engineering", "productivity"] } },
    });
  });

  it("treats a non-empty CLAW.md body as the portable SOUL.md source", () => {
    const bodyManifest = {
      ...manifest,
      workspace: { files: manifest.workspace.files },
    };
    const result = validateTemplatePackageContents({
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
        hasTemplateMarkdownBody: true,
        summary: expect.objectContaining({
          workspace: { bootstrapFiles: ["SOUL.md"], fileCount: 1 },
        }),
      }),
    });
    if (result.ok) expect(result.value).not.toHaveProperty("templateMarkdownBody");
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
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(`---\n${JSON.stringify(value)}\n---\nBe precise.\n`),
    });

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "template_body_soul_conflict" })],
    });
  });

  it.each(["SOUL.md/child", "soul.MD/child", "SOUL.md/cafe\u0301"])(
    "rejects an implicit SOUL.md hierarchy collision at %s",
    (path) => {
      const result = validateTemplatePackageContents({
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
        issues: [expect.objectContaining({ code: "template_body_soul_conflict" })],
      });
    },
  );

  it("accepts one UTF-8 BOM before CLAW.md frontmatter", () => {
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(`\uFEFF---\n${JSON.stringify(manifest)}\n---\n`),
    });

    expect(result.ok).toBe(true);
  });

  it.each(["", "\n \t\n"])("accepts an empty CLAW.md body without implicit SOUL.md", (body) => {
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(`---\n${JSON.stringify(manifest)}\n---\n${body}`),
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        hasTemplateMarkdownBody: false,
        summary: expect.objectContaining({
          workspace: expect.objectContaining({ bootstrapFiles: [] }),
        }),
      }),
    });
  });

  it("rejects a CLAW.md envelope larger than 1 MiB", () => {
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(`---\n${JSON.stringify(manifest)}\n---\n${"x".repeat(1024 * 1024)}`),
    });

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "template_manifest_too_large", path: "CLAW.md" })],
    });
  });

  it("validates supported native settings directly in CLAW.md", () => {
    const agent = { ...manifest.agent, ...parse(openClawProfile).agent };
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(`---\n${JSON.stringify({ ...manifest, agent })}\n---\n`),
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        manifest: { agent },
        inventory: [{ kind: "skill", source: "clawhub", ref: "@acme/triage", version: "1.2.0" }],
      },
    });
    if (result.ok) expect(result.value.summary).not.toHaveProperty("profiles");
  });

  it.each(["profiles/openclaw.yml", "profiles/codex.yml", "Profiles/openclaw.yml"])(
    "rejects retired profile %s with migration guidance",
    (path) => {
      const result = validateTemplatePackageContents({
        packageName: "@acme/github-triage",
        version: "1.0.0",
        packageJson: packageJson(),
        files: [...files(), { path, text: openClawProfile }],
      });
      expect(result).toMatchObject({
        ok: false,
        issues: [
          {
            code: "retired_template_profile",
            path,
            message: expect.stringContaining("CLAW.md agent"),
          },
        ],
      });
    },
  );

  it.each([
    { profile: "future-profile" },
    { profile: "coding" },
    { profile: "messaging" },
    { profile: "full" },
    { profile: "full", allow: ["*"] },
    { alsoAllow: ["read"] },
    { profile: "minimal", allow: ["read"] },
  ])("rejects unbounded or incompatible native tool policy %j", (tools) => {
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(
        `---\n${JSON.stringify({ ...manifest, agent: { ...manifest.agent, tools } })}\n---\n`,
      ),
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a nonempty UTF-8 package-root BOOTSTRAP.md", () => {
    const result = validateTemplatePackageContents({
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
      const result = validateTemplatePackageContents({
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
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: [...files(), { path: "BOOTSTRAP.md", text: bootstrapText }],
    });

    expect(result).toEqual({ ok: false, issues: [expect.objectContaining({ code })] });
  });

  it("rejects the retired profile pointer with migration guidance", () => {
    const result = validateTemplatePackageContents({
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
          code: "invalid_template_manifest",
          path: "$.metadata.openclaw.config",
          message: expect.stringContaining("move native settings into CLAW.md agent"),
        }),
      ],
    });
  });

  it("enforces the shared OpenClaw host environment policy through package validation", () => {
    const result = validateTemplatePackageContents({
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
          code: "invalid_template_manifest",
          path: "$.mcpServers.unsafe.env.CPP",
        }),
      ],
    });
  });

  it.each([
    { heartbeat: { skipWhenBusy: true } },
    { tools: { fs: { workspaceOnly: false } } },
    { tools: { allow: ["read"], alsoAllow: ["write"] } },
    { memory: { search: { sources: ["sessions"] } } },
  ])("rejects unsupported or unsafe native settings %j", (settings) => {
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(
        `---\n${JSON.stringify({ ...manifest, agent: { ...manifest.agent, ...settings } })}\n---\n`,
      ),
    });
    expect(result.ok).toBe(false);
  });

  it.each([
    ["anchor", "agent: &agent { id: github-triage }"],
    ["alias", "agent: { id: &id github-triage, name: *id }"],
    ["merge key", "agent: { <<: { id: github-triage } }"],
    ["explicit tag", "agent: { id: !!str github-triage }"],
    ["non-string mapping key", "agent: { id: github-triage, true: nope }"],
  ])("rejects CLAW.md YAML %s", (_label, declaration) => {
    const result = validateTemplatePackageContents({
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
          "automations: []",
          "---",
        ].join("\n"),
      ),
    });

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "unsupported_template_yaml_feature" })],
    });
  });

  it("does not treat a suffix-only filename as CLAW.md", () => {
    const result = validateTemplatePackageContents({
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
      issues: [expect.objectContaining({ code: "invalid_template_manifest_path" })],
    });
  });

  it("rejects the retired JSON compatibility manifest", () => {
    const jsonManifest = {
      ...manifest,
      workspace: {
        ...manifest.workspace,
        bootstrapFiles: { "SOUL.md": { source: "workspace/SOUL.md" } },
      },
    };
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson("openclaw.template.json"),
      files: [
        ...files().filter((file) => file.path !== "CLAW.md"),
        { path: "openclaw.template.json", text: JSON.stringify(jsonManifest) },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "invalid_template_manifest_path", path: "package.json.openclaw.template" }],
    });
  });

  it("requires package identity to match the publication", () => {
    const result = validateTemplatePackageContents({
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
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: metadata,
      files: files(),
    });

    expect(result.ok).toBe(false);
  });

  it("rejects missing declared workspace sources", () => {
    const result = validateTemplatePackageContents({
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
    const result = validateTemplatePackageContents({
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
    const result = validateTemplatePackageContents({
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
      const result = validateTemplatePackageContents({
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
    const result = validateTemplatePackageContents({
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
    const result = validateTemplatePackageContents({
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
      issues: [expect.objectContaining({ code: "missing_template_manifest" })],
    });
  });

  it("rejects resolved credentials through the shared manifest validator", () => {
    const unsafe = {
      ...manifest,
      mcpServers: { github: { command: "npx", env: { GITHUB_TOKEN: "secret" } } },
    };
    const result = validateTemplatePackageContents({
      packageName: "@acme/github-triage",
      version: "1.0.0",
      packageJson: packageJson(),
      files: files(`---\n${JSON.stringify(unsafe)}\n---\n# Prompt\n`),
    });

    expect(result).toEqual({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_template_manifest",
          path: "$.mcpServers.github.env.GITHUB_TOKEN",
        }),
      ]),
    });
  });
});
