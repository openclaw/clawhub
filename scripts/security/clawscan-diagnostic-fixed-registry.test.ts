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

it("binds exactly fifteen skill identities, their retained manifests and source records", () => {
  expect(validateFixedSkillRegistry(registry)).toEqual(registry);
  expect(FIXED_ORIGINAL_SELECTORS).toEqual([
    "original-038-encrypted",
    "original-079-encrypted",
    "original-004-encrypted",
    "original-016-encrypted",
    "original-017-encrypted",
    "original-026-encrypted",
    "original-027-encrypted",
    "original-074-encrypted",
    "original-008-encrypted",
    "original-011-encrypted",
    "original-036-encrypted",
    "original-033-encrypted",
    "original-065-encrypted",
    "original-073-encrypted",
    "original-042-encrypted",
    "original-055-encrypted",
    "original-039-encrypted",
  ]);
  expect(registry.originals.flatMap((row) => row.files)).toHaveLength(41);
  expect(
    registry.originals.flatMap((row) => row.files).reduce((sum, file) => sum + file.size, 0),
  ).toBe(665215);
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

it("selects the five approved next-frontier originals with their independently retained identities", () => {
  const expected = [
    [
      "074",
      "council-network",
      "0.1.0",
      "docrohit",
      1,
      "b46c8b89bd049fc0f17eddc97b9fc0a40d4ccf152eb3ec4d37b47d84d22fdce2",
    ],
    [
      "008",
      "kritik-participate",
      "1.0.0",
      "icerain-cmd",
      2,
      "58a0517c0b6875eaf3785b85edc86aa32ea802c89aa273cc4f023d343983e00f",
    ],
    [
      "011",
      "webly",
      "0.14.6",
      "tokifyi",
      2,
      "e26d48305b05b66fdd111e59c1a909a0ac0fa8d50e30f133e633eebe5d7f2189",
    ],
    [
      "036",
      "sn-ppt-dazzle",
      "2026.10.29",
      "sensenova-skills",
      4,
      "035f167a29afb5e3b6c75119c1f0872e0c034c0469d7779138d6c4a4cca1d857",
    ],
    [
      "033",
      "gtrk-cover",
      "1.3.9",
      "gitruck",
      6,
      "b497cf1b721d3a337e652ac491cabe3edfcd2f5f20cd7f61370cdbcb57f96b1f",
    ],
  ] as const;
  for (const [fixture, packageName, version, owner, fileCount, manifestSha256] of expected) {
    const selected = selectFixedSkill(fixture);
    expect(selected).toMatchObject({
      id: `${packageName}-${version}`,
      package: packageName,
      version,
      identity: { fixture, package: packageName, version, owner, kind: "skill" },
      manifest: { manifestSha256 },
    });
    expect(selected.manifest.files).toHaveLength(fileCount);
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

it("verifies Python custody and real proxy boundaries for all approved skills without models or credentials", () => {
  expect(() =>
    execFileSync("python3", ["-B", "scripts/security/diagnostic-capture/test_fixed_originals.py"], {
      env: { PATH: process.env.PATH },
      timeout: 20000,
      stdio: "pipe",
    }),
  ).not.toThrow();
});

const followingFive = [
  {
    fixture: "065",
    package: "agent-betap",
    version: "1.0.0",
    owner: "xavierabraham",
    kind: "skill",
    attemptId: "zx739kkrb6530st41qjdzyj0498gy4ac",
    versionId: "k974s4hvs82pcm87xq4kvcd6hh8gzh4a",
    fingerprint: "f5dcf76230e987f39f1da5be27da41459e22e383307af2ebb3a3a2eecd4acfc2",
    manifestSha256: "0df22e4c5e1e6ca5d1ca56d376a2a003b81b1ac392271329e3550d5beb5bb428",
    sourceManifestSha256: "077a78803f16befe1561a9e387e1368676850464c6bfb1006334343238955f0e",
    fileCount: 1,
  },
  {
    fixture: "073",
    package: "smartgate",
    version: "1.0.0",
    owner: "smartgate.network",
    kind: "skill",
    attemptId: "zx72gtz9rezd1kcsc8q3n7e6w18h5w7c",
    versionId: "k9768gzc3ab096hhv1p435xksh8h5y3b",
    fingerprint: "67120c9027ff61682adfde1110807d26653764c8cd0de8a04b5a0a06a2724436",
    manifestSha256: "05a9cab246f922b8dda4e3c3647df42a82e00809b7baed32a697f2b93d3d0602",
    sourceManifestSha256: "c92e03ebe0ea942d34d794abea3ea2ab1817307f9c8a84273bff62a4bc1ae55b",
    fileCount: 1,
  },
  {
    fixture: "042",
    package: "mochilab-skills",
    version: "1.1.1",
    owner: "hznetnewpower",
    kind: "skill",
    attemptId: "zx78bax1x9pyt6qg30y28xx9918h1bcx",
    versionId: "k975k2cff6d99s8b7dng06wy9x8h1zyw",
    fingerprint: "0bfcee19b731b75413a92b08b5598546267ee2801f4734a2873927fcb0b655b3",
    manifestSha256: "61573b29a052d0adbbbc06c9f5e4ac49c1d24e18e50262177a665783f29a32ee",
    sourceManifestSha256: "e6f21d270eb1e48657459b8b5ec76d7bd02487b8354da723e89bb5fa972cf3a2",
    fileCount: 5,
  },
  {
    fixture: "055",
    package: "gtrk-cover",
    version: "1.3.10",
    owner: "gitruck",
    kind: "skill",
    attemptId: "zx72jbarp0t1p4gqfx1hwq01xd8h7bzj",
    versionId: "k97fpbaas23y9j1gdmhzrezs6n8h7qpd",
    fingerprint: "97b77c7947a69a6e6fa14ac19fb9aa1b0352118153e30ff7a3c07c08328e501b",
    manifestSha256: "b497cf1b721d3a337e652ac491cabe3edfcd2f5f20cd7f61370cdbcb57f96b1f",
    sourceManifestSha256: "f0b29790043cb4b159c162a2ee541b59fd32beaf4008d130186f44afc33c6a25",
    fileCount: 6,
  },
  {
    fixture: "039",
    package: "mochi-daily-brief",
    version: "1.0.1",
    owner: "hznetnewpower",
    kind: "skill",
    attemptId: "zx76t425vw81kfrq7vvwjx3m3s8h0mmm",
    versionId: "k971cbssee2wcpn7yrtd77ecf58h0sd5",
    fingerprint: "350b3b296e59cc0c8d1fdfe6f6029347234fbfe08044fcfef2ba7b1d96256e65",
    manifestSha256: "f11b6cb2c09eee75006e571c82b327859728b9d9ec52b770de905cd0516253f0",
    sourceManifestSha256: "6a4f91be65d710522d68a7bef35cbf0de63dd87a83d1cc0b0753f0e57942ca9e",
    fileCount: 7,
  },
] as const;

it.each(followingFive)(
  "binds following original $fixture to its exact reported owner/version and retained files",
  (expected) => {
    const { fileCount, ...identity } = expected;
    const selected = selectFixedSkill(expected.fixture);
    expect(selected.identity).toMatchObject(identity);
    expect(selected.id).toBe(`${expected.package}-${expected.version}`);
    expect(selected.manifest.files).toHaveLength(fileCount);
    expect(hash(JSON.stringify(selected.manifest.files))).toBe(expected.manifestSha256);
  },
);

it.each(followingFive)(
  "rejects every custody substitution for following original $fixture",
  (expected) => {
    const index = registry.originals.findIndex((row) => row.fixture === expected.fixture);
    expect(index).toBeGreaterThanOrEqual(0);
    for (const key of [
      "version",
      "owner",
      "attemptId",
      "versionId",
      "fingerprint",
      "sourceManifestSha256",
      "manifestSha256",
      "files",
    ]) {
      const changed = structuredClone(registry);
      Object.assign(changed.originals[index], { [key]: "substituted" });
      expect(() => validateFixedSkillRegistry(changed)).toThrow("registry identity");
    }
  },
);

it("preserves separate version obligations even when their payload hashes match", () => {
  const earlier = selectFixedSkill("033");
  const following = selectFixedSkill("055");
  expect(earlier.manifest.files).toEqual(following.manifest.files);
  expect(earlier.manifest.manifestSha256).toBe(following.manifest.manifestSha256);
  expect(earlier.version).toBe("1.3.9");
  expect(following.version).toBe("1.3.10");
  expect(earlier.id).not.toBe(following.id);
  expect(earlier.identity.attemptId).not.toBe(following.identity.attemptId);
  expect(earlier.identity.versionId).not.toBe(following.identity.versionId);
  expect(selectFixedSkill("027").id).not.toBe(selectFixedSkill("065").id);
});
