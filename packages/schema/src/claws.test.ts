/* @vitest-environment node */

import { ArkErrors } from "arktype";
import { describe, expect, it, vi } from "vitest";
import {
  CLAW_MANIFEST_VALIDATION_CODES,
  ClawManifestSummarySchema,
  OPENCLAW_CLAW_HOST_ENV_POLICY_V1,
  summarizeClawManifest,
  validateClawManifest,
} from "./claws";
import { PackageFamilySchema, PackagePublishMetadataSchema } from "./packages";

const fixture = {
  schemaVersion: 1,
  agent: { id: "financial-analyst", name: "Financial Analyst" },
  workspace: {
    bootstrapFiles: { "SOUL.md": { source: "workspace/SOUL.md" } },
    files: [{ source: "workspace/reference/policy.md", path: "reference/policy.md" }],
  },
  packages: [
    {
      kind: "skill",
      source: "clawhub",
      ref: "@openclaw/research",
      version: "1.2.3",
    },
    {
      kind: "plugin",
      source: "clawhub",
      ref: "@openclaw/markets",
      version: "2.0.0",
    },
  ],
  mcpServers: {
    filings: {
      url: "https://example.test/mcp",
      transport: "streamable-http",
      auth: "oauth",
    },
  },
  cronJobs: [
    {
      id: "morning-brief",
      schedule: { cron: "0 8 * * 1-5", timezone: "America/New_York" },
      session: "isolated",
      message: "Prepare the morning brief.",
    },
  ],
} as const;

describe("Claw manifest contract", () => {
  it("allows Claws in storage and publication metadata contracts", () => {
    expect(PackageFamilySchema("claw")).toBe("claw");
    expect(
      PackagePublishMetadataSchema({
        name: "@openclaw/financial-analyst",
        family: "claw",
        version: "1.0.0",
        changelog: "Initial release",
      }),
    ).not.toBeInstanceOf(ArkErrors);
  });

  it("accepts the grouped OpenClaw v1 fixture and derives a safe summary", () => {
    const result = validateClawManifest(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(summarizeClawManifest(result.manifest)).toEqual({
      schemaVersion: 1,
      agent: { id: "financial-analyst", name: "Financial Analyst" },
      workspace: { bootstrapFiles: ["SOUL.md"], fileCount: 1 },
      packages: { skillCount: 1, pluginCount: 1 },
      mcpServerCount: 1,
      cronJobCount: 1,
    });
  });

  it("does not schedule timers while validating cron syntax", () => {
    vi.useFakeTimers();
    try {
      expect(validateClawManifest(fixture).ok).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts opaque string metadata for namespaced harness profile pointers", () => {
    const result = validateClawManifest({
      ...fixture,
      metadata: {
        "openclaw.config": "profiles/openclaw.yml",
        "example.hint": "opaque-value",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.metadata).toEqual({
      "openclaw.config": "profiles/openclaw.yml",
      "example.hint": "opaque-value",
    });
  });

  it.each(["", " openclaw.config "])("rejects non-canonical metadata key %j", (metadataKey) => {
    const result = validateClawManifest({
      ...fixture,
      metadata: { [metadataKey]: "opaque-value" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain(`$.metadata.${metadataKey}`);
  });

  it("rejects non-string metadata values and harness policy embedded in the portable agent", () => {
    expect(
      validateClawManifest({
        ...fixture,
        metadata: { "openclaw.config": { path: "profiles/openclaw.yml" } },
      }).ok,
    ).toBe(false);

    expect(
      validateClawManifest({
        ...fixture,
        agent: {
          ...fixture.agent,
          tools: { profile: "coding" },
        },
      }).ok,
    ).toBe(false);

    expect(
      validateClawManifest({
        ...fixture,
        agent: {
          ...fixture.agent,
          memory: { search: { enabled: true } },
        },
      }).ok,
    ).toBe(false);
  });

  it.each([
    "../openclaw.yml",
    "/profiles/openclaw.yml",
    "profiles/openclaw.json",
    "profiles\\openclaw.yml",
  ])("rejects unsafe or non-YAML OpenClaw profile pointer %s", (profilePath) => {
    const result = validateClawManifest({
      ...fixture,
      metadata: { "openclaw.config": profilePath },
    });

    expect(result.ok).toBe(false);
  });

  it("fails closed on unknown fields", () => {
    expect(validateClawManifest({ ...fixture, model: "gpt-5" }).ok).toBe(false);
  });

  it("returns stable v1 codes and schema phases for every rejection", () => {
    const structural = validateClawManifest({ ...fixture, model: "gpt-5" });
    expect(structural.ok).toBe(false);
    if (structural.ok) return;
    expect(structural.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "claw_v1_invalid_manifest_shape",
          phase: "schema",
          path: "$.model",
        }),
      ]),
    );

    const semantic = validateClawManifest({
      ...fixture,
      packages: [{ kind: "skill", source: "clawhub", ref: "demo", version: "latest" }],
    });
    expect(semantic.ok).toBe(false);
    if (semantic.ok) return;
    expect(semantic.issues).toContainEqual({
      code: "claw_v1_invalid_package_version",
      phase: "schema",
      path: "$.packages.0.version",
      message: "Must be an exact semantic version.",
    });
  });

  it("rejects traversal, floating versions, and inline MCP values", () => {
    const result = validateClawManifest({
      ...fixture,
      workspace: { files: [{ source: "../outside", path: "outside" }] },
      packages: [{ kind: "skill", source: "clawhub", ref: "demo", version: "latest" }],
      mcpServers: {
        unsafe: { command: "server", env: { SETTING: "inline-value" } },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "$.workspace.files.0.source",
        "$.packages.0.version",
        "$.mcpServers.unsafe.env.SETTING",
      ]),
    );
  });

  it.each(["01.2.3", "1.2.3-.."])("rejects invalid semantic version %s", (version) => {
    expect(
      validateClawManifest({
        ...fixture,
        packages: [{ kind: "skill", source: "clawhub", ref: "demo", version }],
      }).ok,
    ).toBe(false);
  });

  it("rejects malformed ClawHub package references", () => {
    expect(
      validateClawManifest({
        ...fixture,
        packages: [
          {
            kind: "skill",
            source: "clawhub",
            ref: "not a package",
            version: "1.0.0",
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("rejects non-portable and platform-equivalent workspace destinations", () => {
    const invalidPath = validateClawManifest({
      ...fixture,
      workspace: {
        files: [{ source: "workspace/a\u0000b", path: "reference/a.md" }],
      },
    });
    expect(invalidPath.ok).toBe(false);

    const collision = validateClawManifest({
      ...fixture,
      workspace: {
        files: [
          { source: "workspace/a.md", path: "reference/policy.md" },
          { source: "workspace/b.md", path: "REFERENCE\\policy.md" },
        ],
      },
    });
    expect(collision.ok).toBe(false);

    const hierarchy = validateClawManifest({
      ...fixture,
      workspace: {
        files: [
          { source: "workspace/a.md", path: "reference" },
          { source: "workspace/b.md", path: "reference/policy.md" },
        ],
      },
    });
    expect(hierarchy.ok).toBe(false);
  });

  it.each(["\u007f", "\u0085"])(
    "rejects Unicode control character U+%s in package paths",
    (controlCharacter) => {
      expect(
        validateClawManifest({
          ...fixture,
          workspace: {
            files: [{ source: `workspace/a${controlCharacter}.md`, path: "reference/a.md" }],
          },
        }).ok,
      ).toBe(false);
    },
  );

  it("rejects workspace destinations that collide after Unicode case folding", () => {
    const result = validateClawManifest({
      ...fixture,
      workspace: {
        files: [
          { source: "workspace/a.md", path: "Straße.md" },
          { source: "workspace/b.md", path: "STRASSE.md" },
        ],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain("$.workspace.files.1.path");
  });

  it("rejects credentials embedded in remote MCP URLs", () => {
    const result = validateClawManifest({
      ...fixture,
      mcpServers: {
        filings: {
          url: ["https://alice", "embedded@example.test/mcp"].join(":"),
          transport: "streamable-http",
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      code: CLAW_MANIFEST_VALIDATION_CODES.mcpUrlCredentials,
      phase: "schema",
      path: "$.mcpServers.filings.url",
      message: "Must not contain embedded credentials or fragments.",
    });
  });

  it("rejects ambiguous MCP transport declarations structurally", () => {
    const result = validateClawManifest({
      ...fixture,
      mcpServers: {
        unsafe: { command: "server", url: "https://example.test" },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain("$.mcpServers.unsafe");
  });

  it("rejects infinite MCP timeouts", () => {
    const result = validateClawManifest({
      ...fixture,
      mcpServers: {
        local: { command: "server", timeout: Number.POSITIVE_INFINITY },
        remote: {
          url: "https://example.test/mcp",
          transport: "streamable-http",
          connectTimeout: Number.POSITIVE_INFINITY,
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(["$.mcpServers.local.timeout", "$.mcpServers.remote.connectTimeout"]),
    );
  });

  it("rejects empty portable names and MCP selector lists", () => {
    const result = validateClawManifest({
      ...fixture,
      agent: {
        ...fixture.agent,
        identity: { name: " " },
      },
      mcpServers: {
        local: {
          command: "server",
          args: [""],
          toolFilter: { include: [] },
        },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid cron schedules and empty stdio commands", () => {
    const result = validateClawManifest({
      ...fixture,
      mcpServers: { empty: { command: "   " } },
      cronJobs: [
        {
          id: "broken",
          schedule: { cron: "not-a-cron", timezone: "Not/AZone" },
          session: "isolated",
          message: "Run.",
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(["$.mcpServers.empty.command", "$.cronJobs.0.schedule"]),
    );
  });

  it("allows one ClawHub coordinate under distinct package kinds", () => {
    const result = validateClawManifest({
      ...fixture,
      packages: [
        { kind: "skill", source: "clawhub", ref: "demo", version: "1.0.0" },
        { kind: "plugin", source: "clawhub", ref: "demo", version: "1.0.0" },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("requires local avatars to be portable managed workspace files", () => {
    expect(
      validateClawManifest({
        ...fixture,
        agent: { ...fixture.agent, identity: { avatar: "avatars/analyst.png" } },
      }).ok,
    ).toBe(false);

    expect(
      validateClawManifest({
        ...fixture,
        agent: { ...fixture.agent, identity: { avatar: "avatars/analyst.png" } },
        workspace: {
          ...fixture.workspace,
          files: [
            ...fixture.workspace.files,
            { source: "workspace/avatars/analyst.png", path: "avatars/analyst.png" },
          ],
        },
      }).ok,
    ).toBe(true);

    expect(
      validateClawManifest({
        ...fixture,
        agent: { ...fixture.agent, identity: { avatar: "https://example.test/avatar.png" } },
      }).ok,
    ).toBe(false);

    expect(
      validateClawManifest({
        ...fixture,
        agent: { ...fixture.agent, identity: { avatar: "data:image/bmp;base64,AA==" } },
      }).ok,
    ).toBe(true);
  });

  it("enforces portable MCP and cron declarations", () => {
    const result = validateClawManifest({
      ...fixture,
      mcpServers: {
        floating: {
          command: "npx",
          args: ["mcp-server@latest"],
          env: { "BAD-KEY": "${BAD_KEY}" },
          toolFilter: { include: ["search", "search"] },
        },
        remote: {
          url: "http://example.test/mcp#token",
          transport: "streamable-http",
        },
      },
      cronJobs: [
        {
          id: "brief",
          schedule: { cron: "0 8 * * * *", timezone: "UTC" },
          session: "isolated",
          message: "Prepare brief.",
          delivery: { mode: "none", channel: "last" },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "$.mcpServers.floating.args",
        "$.mcpServers.floating.env.BAD-KEY",
        "$.mcpServers.floating.toolFilter.include.1",
        "$.mcpServers.remote.url",
        "$.cronJobs.0.schedule",
        "$.cronJobs.0.delivery",
      ]),
    );
  });

  it("enforces the versioned OpenClaw spawned-process environment policy", () => {
    expect(OPENCLAW_CLAW_HOST_ENV_POLICY_V1.blockedKeys).toContain("CPP");
    const blockedKeys = [
      ...OPENCLAW_CLAW_HOST_ENV_POLICY_V1.blockedKeys,
      ...OPENCLAW_CLAW_HOST_ENV_POLICY_V1.blockedPrefixes.map(
        (prefix) => `${prefix}CLAW_CONFORMANCE_TEST`,
      ),
    ];
    const result = validateClawManifest({
      ...fixture,
      mcpServers: {
        local: {
          command: "server",
          env: Object.fromEntries(blockedKeys.map((key) => [key, `\${${key}}`] as const)),
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const rejectedKeys = result.issues
      .filter((issue) => issue.code === CLAW_MANIFEST_VALIDATION_CODES.blockedEnvironmentKey)
      .map((issue) => issue.path.replace("$.mcpServers.local.env.", ""));
    expect(new Set(rejectedKeys)).toEqual(new Set(blockedKeys));
  });

  it("rejects any floating package selected by an MCP runner", () => {
    expect(
      validateClawManifest({
        ...fixture,
        mcpServers: {
          unsafe: {
            command: "npx",
            args: ["--package", "safe@1.0.0", "--package", "unsafe@latest", "server"],
          },
        },
      }).ok,
    ).toBe(false);

    for (const [command, args] of [
      ["npm", ["exec", "--yes", "unsafe@latest"]],
      ["npm", ["x", "unsafe@latest"]],
      ["bun", ["x", "unsafe@latest"]],
    ] as const) {
      expect(
        validateClawManifest({
          ...fixture,
          mcpServers: { unsafe: { command, args: [...args] } },
        }).ok,
      ).toBe(false);
    }

    expect(
      validateClawManifest({
        ...fixture,
        mcpServers: { safe: { command: "npm", args: ["exec", "safe@1.0.0"] } },
      }).ok,
    ).toBe(true);
  });

  it("checks npm exec package selectors that follow the inferred command", () => {
    const result = validateClawManifest({
      ...fixture,
      mcpServers: {
        unsafe: {
          command: "npm",
          args: ["exec", "safe@1.0.0", "--package=unsafe@latest"],
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain("$.mcpServers.unsafe.args");

    expect(
      validateClawManifest({
        ...fixture,
        mcpServers: {
          safe: {
            command: "npm",
            args: ["exec", "safe@1.0.0", "--", "--package=child-argument"],
          },
        },
      }).ok,
    ).toBe(true);
  });

  it.each([
    ["npx", ["--cache", "safe@1.0.0", "unsafe@latest"]],
    ["npm", ["exec", "--cache", "safe@1.0.0", "unsafe@latest"]],
  ] as const)("fails closed on unrecognized %s options before the package", (command, args) => {
    expect(
      validateClawManifest({
        ...fixture,
        mcpServers: { unsafe: { command, args: [...args] } },
      }).ok,
    ).toBe(false);
  });

  it.each([
    ["npm", ["run", "serve"]],
    ["bun", ["run", "serve"]],
    ["pnpm", ["run", "serve"]],
    ["yarn", ["run", "serve"]],
  ] as const)(
    "does not classify non-download %s commands as package selectors",
    (command, args) => {
      expect(
        validateClawManifest({
          ...fixture,
          mcpServers: { local: { command, args: [...args] } },
        }).ok,
      ).toBe(true);
    },
  );

  it("keeps public manifest summaries bounded", () => {
    const result = validateClawManifest({
      ...fixture,
      agent: {
        ...fixture.agent,
        name: "n".repeat(500),
        description: "d".repeat(5_000),
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summary = summarizeClawManifest(result.manifest);

    expect(summary.agent.name).toHaveLength(128);
    expect(summary.agent.description).toHaveLength(1_024);
    expect(ClawManifestSummarySchema.allows(summary)).toBe(true);
    expect(
      ClawManifestSummarySchema.allows({
        ...summary,
        agent: { ...summary.agent, description: "d".repeat(1_025) },
      }),
    ).toBe(false);
  });

  it("does not treat child-process arguments as package-manager selectors", () => {
    expect(
      validateClawManifest({
        ...fixture,
        mcpServers: {
          safe: {
            command: "npx",
            args: ["--package", "safe@1.0.0", "server", "--package", "child-argument"],
          },
        },
      }).ok,
    ).toBe(true);
    expect(
      validateClawManifest({
        ...fixture,
        mcpServers: { unsafe: { command: "npx", args: ["--", "unsafe@latest"] } },
      }).ok,
    ).toBe(false);
  });

  it("rejects padded strict strings, unsupported tool globs, and dangerous env keys", () => {
    const result = validateClawManifest({
      ...fixture,
      agent: { ...fixture.agent, name: " Financial Analyst" },
      mcpServers: {
        local: {
          command: "node",
          env: {
            NODE_OPTIONS: "${NODE_OPTIONS}",
            LD_PRELOAD: "${LD_PRELOAD}",
          },
          toolFilter: { include: ["issue?", "issue[0-9]"] },
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "$.agent.name",
        "$.mcpServers.local.env.NODE_OPTIONS",
        "$.mcpServers.local.env.LD_PRELOAD",
        "$.mcpServers.local.toolFilter.include.0",
        "$.mcpServers.local.toolFilter.include.1",
      ]),
    );
  });

  it("requires an explicit timezone and rejects host-relative cron sessions", () => {
    expect(
      validateClawManifest({
        ...fixture,
        cronJobs: [
          {
            id: "brief",
            schedule: { cron: "0 8 * * *" },
            session: "isolated",
            message: "Prepare brief.",
          },
        ],
      }).ok,
    ).toBe(false);
    expect(
      validateClawManifest({
        ...fixture,
        cronJobs: [
          {
            id: "brief",
            schedule: { cron: "0 8 * * *", timezone: "UTC" },
            session: "current",
            message: "Prepare brief.",
          },
        ],
      }).ok,
    ).toBe(false);
  });
});
