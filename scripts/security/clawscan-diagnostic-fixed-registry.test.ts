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

it("binds exactly thirty skill identities, their retained manifests and source records", () => {
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
    "original-010-encrypted",
    "original-019-encrypted",
    "original-005-encrypted",
    "original-006-encrypted",
    "original-015-encrypted",
    "original-071-encrypted",
    "original-007-encrypted",
    "original-009-encrypted",
    "original-014-encrypted",
    "original-013-encrypted",
    "original-029-encrypted",
    "original-030-encrypted",
    "original-002-encrypted",
    "original-003-encrypted",
    "original-067-encrypted",
  ]);
  expect(registry.originals.flatMap((row) => row.files)).toHaveLength(264);
  expect(
    registry.originals.flatMap((row) => row.files).reduce((sum, file) => sum + file.size, 0),
  ).toBe(2574304);
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

it.each(["0", "1"])(
  "verifies Python custody and real proxy boundaries without credentials (shard %s)",
  (shard) => {
    expect(() =>
      execFileSync(
        "python3",
        ["-B", "scripts/security/diagnostic-capture/test_fixed_originals.py"],
        {
          env: { PATH: process.env.PATH, CLAWSCAN_TEST_PROXY_SHARD: shard },
          timeout: 20000,
          stdio: "pipe",
        },
      ),
    ).not.toThrow();
  },
  25000,
);

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

const subsequentFive = [
  {
    fixture: "010",
    package: "brewpage-publish",
    version: "1.0.8",
    owner: "kochetkov-ma",
    kind: "skill",
    attemptId: "zx72qjk2b7adfc3xfketc55d7h8h2ct3",
    versionId: "k974szd30ckskwfma437qapfd58h34gv",
    fingerprint: "0584354479d17011f38eb4122c8693e0d56ba3289c46caa4dc3226ad55266a3d",
    manifestSha256: "a37695ad0434ec3579f70705e2f5f10b73ff97317d02305c6bb7eac1dfd09160",
    sourceManifestSha256: "57f66ee901dd7ae2fbcf23954f055cc9ddff2a3ef79be8f9146a3cd342c210e3",
    fileCount: 7,
  },
  {
    fixture: "019",
    package: "hookaido",
    version: "2.15.3",
    owner: "7schmiede",
    kind: "skill",
    attemptId: "zx78v8whzmepebrr7t8489tqa58h877q",
    versionId: "k971asg1bx11v8efjtdn554d8n8h9r4b",
    fingerprint: "aefe9b9deb288ad20fc5213557a142b059cacb9856bd97f9d5f32b5ab40f643e",
    manifestSha256: "ec0a413aa333045b23a4d0e2acb195bb27b5bc110db123fccdde6c9e5380eb12",
    sourceManifestSha256: "b2039d335eebacfecd986a9f27f50899b6109bd7f427f6d2774ae6fdb16f52e6",
    fileCount: 9,
  },
  {
    fixture: "005",
    package: "xiapan-music",
    version: "0.1.0",
    owner: "dongsheng123132",
    kind: "skill",
    attemptId: "zx7b487av1k20f0ctys5n9t8h58h4v9g",
    versionId: "k972v7hrpjv0ds1zwperc1yx858h43pp",
    fingerprint: "92f5b51d896a15584a90034cf91a88d7108f0b727a009a5833b64230c40cedea",
    manifestSha256: "83fa9eabb8ce424d2b2ac0daed1a671486e5740abb2e7a71da01224dc62aba59",
    sourceManifestSha256: "d22cacf3c276970c945b94509a3ba883c035863a3e05d698247a6a8a807acb55",
    fileCount: 9,
  },
  {
    fixture: "006",
    package: "xiapan-music",
    version: "0.1.1",
    owner: "dongsheng123132",
    kind: "skill",
    attemptId: "zx7284aer96fg31dge0bs406rs8h53dc",
    versionId: "k97b1ptq47bs8sjewf8xx73v898h4p75",
    fingerprint: "a8ce606b7131c63e7f92fb77b631096a6bf50defd75fbd73462f601af12fc27f",
    manifestSha256: "121ce0a19ac22e8fbea4fed9025127429a8464fed8e82ff684d376ab961e199c",
    sourceManifestSha256: "1cc155fc44227ecc4a4b3eba36321dc1f9aa959260ccb13d8b1e381f50e7f13b",
    fileCount: 9,
  },
  {
    fixture: "015",
    package: "agentlifeboat",
    version: "1.0.2",
    owner: "king-perb",
    kind: "skill",
    attemptId: "zx7f16v03prv0500fdvb092wxn8h2ejy",
    versionId: "k977873s0ct949cbq3p9etee1s8h2k4p",
    fingerprint: "b4a6891269bc096cc7679fcd4e44f2641b4f78867af5ffb090c52f4dd5f8cf2b",
    manifestSha256: "1cf20d0e01a3a87af35e77e21e79ee094fdd5dedbe8ad5dc5f82800461ab4021",
    sourceManifestSha256: "dce8d0e7904374cb81ad51ed2cba4c23dd2f49671f74620abb6eed8c6730817c",
    fileCount: 9,
  },
] as const;

it.each(subsequentFive)(
  "binds subsequent original $fixture to its exact reported owner/version and retained files",
  (expected) => {
    const { fileCount, ...identity } = expected;
    const selected = selectFixedSkill(expected.fixture);
    expect(selected.identity).toMatchObject(identity);
    expect(selected.id).toBe(`${expected.package}-${expected.version}`);
    expect(selected.manifest.files).toHaveLength(fileCount);
    expect(hash(JSON.stringify(selected.manifest.files))).toBe(expected.manifestSha256);
  },
);

it.each(subsequentFive)(
  "rejects every custody substitution for subsequent original $fixture",
  (expected) => {
    const index = registry.originals.findIndex((row) => row.fixture === expected.fixture);
    expect(index).toBeGreaterThanOrEqual(0);
    for (const key of Object.keys(registry.originals[index])) {
      const changed = structuredClone(registry);
      Object.assign(changed.originals[index], { [key]: "substituted" });
      expect(() => validateFixedSkillRegistry(changed)).toThrow("registry identity");
    }
  },
);

it("keeps both Xiapan versions bound to their own instructions and publication attempts", () => {
  const earlier = selectFixedSkill("005");
  const later = selectFixedSkill("006");
  expect(earlier.version).toBe("0.1.0");
  expect(later.version).toBe("0.1.1");
  const instructionHash = (selected: typeof earlier) =>
    selected.manifest.files.find((file) => file.path === "SKILL.md")!.sha256;
  expect(instructionHash(earlier)).toBe(
    "f089686b20d3689b05b6efe52692438f71884b5eb3e1788ba56b1bf59ead3250",
  );
  expect(instructionHash(later)).toBe(
    "9b83e364cbd201b9d9dbfbc900479f57c4475dd20d7c6087e2cdda6c9790ef85",
  );
  expect(earlier.manifest.files.filter((file) => file.path !== "SKILL.md")).toEqual(
    later.manifest.files.filter((file) => file.path !== "SKILL.md"),
  );
  expect(earlier.identity.attemptId).not.toBe(later.identity.attemptId);
  expect(earlier.identity.versionId).not.toBe(later.identity.versionId);
  expect(earlier.identity.fingerprint).not.toBe(later.identity.fingerprint);
});

const nextTen = [
  {
    fixture: "071",
    package: "second-read",
    version: "0.3.1",
    owner: "c-kapsalis",
    kind: "skill",
    attemptId: "zx7begmqj11wxkyjwjgp6a3qzh8h41cq",
    fingerprint: "c8d68fd0f6b596a04b89f1e77b48c6227ba092235eed1a9b1b2835d961d79ad8",
    versionId: "k978wewzk6t20m5cc8xqgyhyzn8h5sjc",
    sourceManifestSha256: "ba45daa10420f82974b61f80d91a292545145f7a09624c83b320d8cb286cc279",
    manifestSha256: "5930a4f208818dd4fbd0adbbde6711c2b38965505a463eb8a3afc811f10b0d00",
    fileCount: 34,
  },
  {
    fixture: "007",
    package: "stella-selfie",
    version: "1.4.1",
    owner: "tower1229",
    kind: "skill",
    attemptId: "zx78f5dhed5n9g4h1y36dbff618h9abe",
    fingerprint: "f0091ae805d185a18449618a6e5d8a59104d7714fb7ea4f622eb1527e411e8eb",
    versionId: "k97avh2p20zbv2tgzjhjyxgyxn8h8je9",
    sourceManifestSha256: "469b39cfe73e5456b23ea7515c40bacedabcdfb9c48db13befb36a429fbc5219",
    manifestSha256: "346ff87cb6e7d4f66faf19ede2fafec52e0d54c9037ec0ccf743dc6cdcf14bd7",
    fileCount: 14,
  },
  {
    fixture: "009",
    package: "javis-todo-spend-tracker",
    version: "0.1.1",
    owner: "samuel-wei",
    kind: "skill",
    attemptId: "zx75g2dh7jxbj327wnsmkmrrk98h5tm3",
    fingerprint: "e99a2d2b360cf1ec7e85bc483b1998f1b859ae44552d2ac82eed7013a022b534",
    versionId: "k97cepknqgp888bqr6m44mwzvn8h4qvh",
    sourceManifestSha256: "1408c808563188e3eb71ac861a41d956dfeef9807164de4320fe0bb6ce0c9abc",
    manifestSha256: "99da6f6513c80b9f78633892e09055dbcdf3821b6f81212312b3fa68e4bc5f6c",
    fileCount: 18,
  },
  {
    fixture: "014",
    package: "ego-browser",
    version: "2.1.0",
    owner: "citrolabs",
    kind: "skill",
    attemptId: "zx7e05pa472tst2nc2y5dyp95n8h589n",
    fingerprint: "6c2a8bf3e3f61168ef9e7e4f050d45fb7ea7586bfbdd82b08270ab9d82874717",
    versionId: "k97fvynkxx3emdpgkctnt7jvk98h4ph4",
    sourceManifestSha256: "95487f3040827babc0477c96a172a33d7d589382be72026d74ee949b86ba5bd5",
    manifestSha256: "fe14f86e0c27f92c946d52cf6685445d49ef934eb3c99b05fc8a026b2f003827",
    fileCount: 22,
  },
  {
    fixture: "013",
    package: "whetstone",
    version: "0.1.1",
    owner: "ricardodpalmeida",
    kind: "skill",
    attemptId: "zx738dpm6vphkdkz4wc31aac1h8gzk7g",
    fingerprint: "e82055128b8bd5b314be35715ff60cc2555aeb7b09148c6dea755209837b5efe",
    versionId: "k97bgry95535vztt8xfkbp122n8gyew8",
    sourceManifestSha256: "fe447d70b3bd0f1596b3ae7bfd2bfd6bad89d538003ed615940cef1b554c658a",
    manifestSha256: "f8c91902ec4e11b9f37b707c8aa3f41533e8523b1c3b93a0f0eed9ef2a887619",
    fileCount: 34,
  },
  {
    fixture: "029",
    package: "yahoo-mail",
    version: "1.0.0",
    owner: "maton",
    kind: "skill",
    attemptId: "zx71zpctz443jh91tshwkna8px8h9ep1",
    fingerprint: "8776c5e01b49d6d08c4d66f97a9266785e235d4ae92d6044cb708d8307071a28",
    versionId: "k97bvee0nymw2g6atk628b37hs8h92y1",
    sourceManifestSha256: "d3166e90d656da760cacecd1e30c675340365d544920c7dc3becb1e5fe1afbee",
    manifestSha256: "4436da1c54229f40a0fda62a99c1776c13fdfb5b04234790bcd5374ec7eb8cf9",
    fileCount: 10,
  },
  {
    fixture: "030",
    package: "icloud-mail",
    version: "1.0.0",
    owner: "maton",
    kind: "skill",
    attemptId: "zx7bqs3576c9ckmbhs9hj35shd8h8g6p",
    fingerprint: "8e34bdb229674fe06e2fd21639b18b07b9fd1b9486b8d78b2035c748327558ce",
    versionId: "k97drcmnczhx59kwefaev8vyys8h8ya4",
    sourceManifestSha256: "05baa806c9600a43a574d9f4704ce6fe80db3901178df1bba0f618d118b6719b",
    manifestSha256: "d086594ee374bc302b3cf3a7d7fc84633aab99c992a78757d65d5d2d6201eb9f",
    fileCount: 10,
  },
  {
    fixture: "002",
    package: "klingai",
    version: "2.0.1",
    owner: "klingai-dev",
    kind: "skill",
    attemptId: "zx70z24x7bf2vt0hb78ktbjhys8h5zhs",
    fingerprint: "a47e127a42e858cf3d6f94d39fa521214aa7dda84f195863b3e816eb08e523b1",
    versionId: "k97c5zbe807qeazd7jctgje8ed8h4nx6",
    sourceManifestSha256: "317db3304c4b01134c5f9e2867fd90d0e4a38a78d0a17842fc0b65c205b4bdc8",
    manifestSha256: "41e405c5314abc623e59a3588a936a3e1f370ffa01f80080f894eab7e219eadb",
    fileCount: 13,
  },
  {
    fixture: "003",
    package: "klingai",
    version: "2.0.2",
    owner: "klingai-dev",
    kind: "skill",
    attemptId: "zx73x0m0h1bb6bznzkjfm2asx18h5jd3",
    fingerprint: "a47e127a42e858cf3d6f94d39fa521214aa7dda84f195863b3e816eb08e523b1",
    versionId: "k9718tmwhtqj7zmx99mmqk18f18h5jg5",
    sourceManifestSha256: "51717e742340f503c10782f6d30f87a18c98461b9627c9167799145c77297fae",
    manifestSha256: "41e405c5314abc623e59a3588a936a3e1f370ffa01f80080f894eab7e219eadb",
    fileCount: 13,
  },
  {
    fixture: "067",
    package: "mochi-diff-review",
    version: "1.0.0",
    owner: "hznetnewpower",
    kind: "skill",
    attemptId: "zx7ag4zdmjyr59trspxsxxnqxn8h1y3f",
    fingerprint: "96b2c77b1834e5524e84a9d55d1266cff577808059ed94fbcdf62f2a936bbcdd",
    versionId: "k973xvpm76j8d4dmmwc0aq026d8h0hpy",
    sourceManifestSha256: "e3acf6670301960741823162f3debbf1c0ab50d2d90026bdf7f640d3766a6d12",
    manifestSha256: "e38a9a41f95bd47289ee7f23be7d910d7fa2365c98ec9326e603985079349c11",
    fileCount: 12,
  },
] as const;

it.each(nextTen)(
  "binds next original $fixture to its reported version, attempt and retained manifest",
  (expected) => {
    const { fileCount, ...identity } = expected;
    const selected = selectFixedSkill(expected.fixture);
    expect(selected.identity).toMatchObject(identity);
    expect(selected.manifest.files).toHaveLength(fileCount);
    expect(hash(JSON.stringify(selected.manifest.files))).toBe(expected.manifestSha256);
  },
);

it.each(nextTen)(
  "rejects identity, provenance and file substitutions for next original $fixture",
  (expected) => {
    const index = registry.originals.findIndex((row) => row.fixture === expected.fixture);
    expect(index).toBeGreaterThanOrEqual(0);
    for (const key of Object.keys(registry.originals[index])) {
      const changed = structuredClone(registry);
      Object.assign(changed.originals[index], { [key]: "substituted" });
      expect(() => validateFixedSkillRegistry(changed)).toThrow("registry identity");
    }
  },
);

it("keeps both KlingAI release obligations separate even when every retained byte matches", () => {
  const earlier = selectFixedSkill("002");
  const later = selectFixedSkill("003");
  expect(earlier.manifest.files).toEqual(later.manifest.files);
  expect(earlier.manifest.manifestSha256).toBe(later.manifest.manifestSha256);
  expect(earlier.identity.fingerprint).toBe(later.identity.fingerprint);
  expect(earlier.version).toBe("2.0.1");
  expect(later.version).toBe("2.0.2");
  expect(earlier.identity.attemptId).not.toBe(later.identity.attemptId);
  expect(earlier.identity.versionId).not.toBe(later.identity.versionId);
  expect(earlier.id).not.toBe(later.id);
});
