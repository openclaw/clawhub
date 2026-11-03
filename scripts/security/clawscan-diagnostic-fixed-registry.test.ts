/* @vitest-environment node */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import {
  FIXED_ORIGINAL_SELECTORS,
  FIXED_SKILL_REGISTRY_SHA256,
  selectFixedSkill,
  validateFixedSkillRegistry,
} from "./clawscan-diagnostic-fixed-registry";
import { materializeFixedSkill } from "./clawscan-diagnostic-fixed038";
import registry from "./diagnostic-capture/fixed-originals.json";
import { main } from "./run-clawscan-diagnostic";

const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("binds exactly five skill identities, their retained manifests and source records", () => {
  expect(validateFixedSkillRegistry(registry)).toEqual(registry);
  expect(FIXED_ORIGINAL_SELECTORS).toEqual([
    "original-038-encrypted",
    "original-079-encrypted",
    "original-004-encrypted",
    "original-016-encrypted",
    "original-017-encrypted",
    "original-026-encrypted",
    "original-027-encrypted",
  ]);
  expect(registry.originals.flatMap((row) => row.files)).toHaveLength(6);
  expect(
    registry.originals.flatMap((row) => row.files).reduce((sum, file) => sum + file.size, 0),
  ).toBe(114383);
  for (const row of registry.originals) {
    const selected = selectFixedSkill(row.fixture);
    expect(selected.identity).toEqual(row);
    expect(selected.registrySha256).toBe(FIXED_SKILL_REGISTRY_SHA256);
    expect(hash(JSON.stringify(selected.manifest.files))).toBe(row.manifestSha256);
    expect(row.kind).toBe("skill");
    expect(row.download).toBe(
      `https://clawhub.ai/api/v1/download?slug=${row.package}&version=${row.version}`,
    );
    selected.identity.owner = "cannot-mutate-the-registry";
    expect(selectFixedSkill(row.fixture).identity.owner).toBe(row.owner);
  }
});

it("rejects every registry identity substitution, duplicates and unapproved selection", () => {
  const mutations = [
    { ...registry, source: "0".repeat(40) },
    { ...registry, originals: [...registry.originals, registry.originals[0]] },
    { ...registry, originals: registry.originals.slice(1) },
  ];
  for (const key of Object.keys(registry.originals[0])) {
    const changed = structuredClone(registry);
    Object.assign(changed.originals[0], { [key]: "substituted" });
    mutations.push(changed);
  }
  for (const changed of mutations)
    expect(() => validateFixedSkillRegistry(changed)).toThrow("registry identity");
  for (const id of ["999", "038", "079", "027,026", "../027", "https://invalid.example"])
    expect(() => selectFixedSkill(id)).toThrow("Only fixed originals");
});

it.each(registry.originals)(
  "uses only $package $version's fixed anonymous transfer",
  async (row) => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    await expect(selectFixedSkill(row.fixture).download()).rejects.toThrow(
      "public download unavailable",
    );
    expect(fetch).toHaveBeenCalledExactlyOnceWith(row.download, {
      signal: expect.any(AbortSignal),
      redirect: "error",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(10 * 1024 * 1024 + 1))),
    );
    await expect(selectFixedSkill(row.fixture).download()).rejects.toThrow("archive exceeds limit");
  },
);

it.each(registry.originals)(
  "dispatches $selector only with the fresh encrypted workflow guard",
  async (row) => {
    vi.stubGlobal("process", {
      ...process,
      platform: "linux",
      arch: "x64",
      env: {
        GITHUB_ACTIONS: "true",
        RUNNER_OS: "Linux",
        RUNNER_ARCH: "X64",
        CLAWSCAN_DIAGNOSTIC_RUNNER: "ubuntu-22.04",
        RUNNER_TEMP: "/never-created",
        GITHUB_RUN_ATTEMPT: "2",
        GITHUB_RUN_ID: "123",
        DIAGNOSTIC_AGE_RECIPIENT: "age1xmwwc06ly3ee5rytxm9mflaz2u56jjj36s0mypdrwsvlul66mv4q47ryef",
      },
    });
    await expect(main(["--fixture", row.selector, "--source", "reviewed"])).rejects.toThrow(
      "fresh workflow run",
    );
    for (const args of [
      ["--fixture", row.selector, "--source", "incident"],
      ["--fixture", row.selector, "--source", "reviewed", "--fixture", row.selector],
      ["--fixture", row.selector, "--source", "reviewed", "--url", row.download],
      ["--fixture", row.selector, "--source", "reviewed", "--manifest", "anything"],
    ])
      await expect(main(args)).rejects.toThrow();
  },
);

it("rejects changed, missing, extra and cross-case original bytes before creating a target", async () => {
  const root = await mkdtemp(join(tmpdir(), "fixed-skills-reject-"));
  try {
    for (const row of registry.originals) {
      const selected = selectFixedSkill(row.fixture);
      for (const files of [
        {},
        Object.fromEntries(row.files.map((file) => [file.path, Buffer.alloc(file.size)])),
        {
          ...Object.fromEntries(row.files.map((file) => [file.path, Buffer.alloc(file.size)])),
          extra: Buffer.alloc(0),
        },
        {
          "SKILL.md": Buffer.alloc(
            registry.originals.find((other) => other.fixture !== row.fixture)!.files[0].size,
          ),
        },
      ])
        await expect(
          selected.materialize(Buffer.from(zipSync(files)), join(root, row.fixture)),
        ).rejects.toThrow();
    }
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("reuses exact ZIP validation with honest generated-container identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "fixed-skill-zip-control-"));
  const bytes = Buffer.from("INERT CONTROL\n");
  const files = [{ path: "SKILL.md", sha256: hash(bytes), size: bytes.length }];
  const manifest = {
    archiveSha256: "0".repeat(64),
    manifestSha256: hash(JSON.stringify(files)),
    files,
  };
  try {
    const generatedMetadata: Record<string, Uint8Array>[] = [
      {},
      { "_meta.json": Buffer.from("{}"), "skill-card.md": Buffer.from("generated") },
    ];
    for (const extras of generatedMetadata) {
      const archive = Buffer.from(zipSync({ "SKILL.md": bytes, ...extras }));
      const target = join(root, `positive-${Object.keys(extras).length}`);
      expect(await materializeFixedSkill(archive, target, manifest)).toMatchObject({
        files: 1,
        bytes: bytes.length,
        manifestSha256: manifest.manifestSha256,
        transferSha256: hash(archive),
        originalCompressedArchiveIdentityProven: false,
      });
      await chmod(target, 0o700);
    }
    const archive = Buffer.from(zipSync({ "SKILL.md": bytes }));
    const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    for (const mode of [0o120777, 0o010600, 0o040700]) {
      const changed = Buffer.from(archive);
      changed.writeUInt32LE((mode << 16) >>> 0, central + 38);
      await expect(
        materializeFixedSkill(changed, join(root, `mode-${mode}`), manifest),
      ).rejects.toThrow("entry");
    }
    for (const extra of ["SKILL.md/extra", "unknown", "_meta.json"]) {
      const archive = Buffer.from(
        zipSync({ "SKILL.md": bytes, [extra]: Buffer.alloc(extra === "_meta.json" ? 65537 : 0) }),
      );
      await expect(materializeFixedSkill(archive, join(root, "extra"), manifest)).rejects.toThrow();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("verifies Python custody and real proxy boundaries for all five skills without models or credentials", () => {
  expect(() =>
    execFileSync("python3", ["-B", "scripts/security/diagnostic-capture/test_fixed_originals.py"], {
      env: { PATH: process.env.PATH },
      timeout: 20000,
      stdio: "pipe",
    }),
  ).not.toThrow();
});
