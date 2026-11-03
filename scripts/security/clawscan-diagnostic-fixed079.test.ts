/* @vitest-environment node */
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  downloadOriginal079,
  materializeOriginal079,
  ORIGINAL079_DOWNLOAD,
  original079Manifest,
} from "./clawscan-diagnostic-fixed079";
import { main } from "./run-clawscan-diagnostic";
import { mainFixedOriginalDiagnostic } from "./run-clawscan-original038-diagnostic";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("preserves fixed plugin applicability and real proxy capture boundaries without credentials", () => {
  expect(() =>
    execFileSync(
      "python3",
      ["-B", "scripts/security/diagnostic-capture/test_original079_applicability.py"],
      {
        env: { PATH: process.env.PATH },
        timeout: 15000,
        stdio: "pipe",
      },
    ),
  ).not.toThrow();
});

it.each([
  { arch: "arm64", runner: "ubuntu-22.04", attempt: "1" },
  { arch: "x64", runner: "blacksmith-16vcpu-ubuntu-2404", attempt: "1" },
  { arch: "x64", runner: "ubuntu-22.04", attempt: "2" },
])("refuses another platform or a rerun before setup: %j", async ({ arch, runner, attempt }) => {
  vi.stubGlobal("process", {
    ...process,
    platform: "linux",
    arch,
    env: {
      GITHUB_ACTIONS: "true",
      RUNNER_OS: "Linux",
      RUNNER_ARCH: "X64",
      CLAWSCAN_DIAGNOSTIC_RUNNER: runner,
      RUNNER_TEMP: "/never-created",
      GITHUB_RUN_ATTEMPT: attempt,
      GITHUB_RUN_ID: "123",
      DIAGNOSTIC_AGE_RECIPIENT: "age1xmwwc06ly3ee5rytxm9mflaz2u56jjj36s0mypdrwsvlul66mv4q47ryef",
    },
  });
  await expect(
    main(["--fixture", "original-079-encrypted", "--source", "reviewed"]),
  ).rejects.toThrow("native Ubuntu22 X64 and a fresh workflow run");
});

it("dispatches only the exact fixed plugin route and refuses missing encryption before setup", async () => {
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
    },
  });
  await expect(
    main(["--fixture", "original-079-encrypted", "--source", "reviewed"]),
  ).rejects.toThrow("age X25519 recipient");
  await expect(mainFixedOriginalDiagnostic("unbounded" as "079")).rejects.toThrow(
    "Only fixed originals",
  );
  for (const args of [
    ["--fixture", "original-079-encrypted", "--source", "incident"],
    ["--fixture", "original-079-encrypted", "--source", "reviewed", "--retry"],
    [
      "--fixture",
      "original-079-encrypted",
      "--source",
      "reviewed",
      "--url",
      "https://invalid.example",
    ],
  ])
    await expect(main(args)).rejects.toThrow();
});

it("binds every retained McPherson original and the immutable npm archive", () => {
  expect(original079Manifest.files).toHaveLength(106);
  expect(original079Manifest.files.reduce((sum, file) => sum + file.size, 0)).toBe(762020);
  expect(createHash("sha256").update(JSON.stringify(original079Manifest.files)).digest("hex")).toBe(
    "3c28e5bc78b2dc13fa817b7faa3b14a0f1810fd22a7faf1055d2cde7fe3a44c0",
  );
  expect(original079Manifest.archiveSha256).toBe(
    "8741819e883c1deebf30dbc3a2c150bee0359f4c99d1793745e72fad6064844e",
  );
  expect(original079Manifest.files.some((file) => file.path === "openclaw.plugin.json")).toBe(true);
  expect(original079Manifest.files.some((file) => file.path === "SKILL.md")).toBe(false);
});

it.each([Buffer.from("not the original npm archive"), Buffer.alloc(191470)])(
  "rejects changed original archive bytes before creating any input",
  async (archive) => {
    const root = await mkdtemp(join(tmpdir(), "fixed079-reject-"));
    try {
      await expect(materializeOriginal079(archive, join(root, "original"))).rejects.toThrow(
        "archive identity mismatch",
      );
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("downloads only the fixed anonymous exact version with redirects disabled", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  await expect(downloadOriginal079()).rejects.toThrow("public download unavailable");
  expect(fetch).toHaveBeenCalledExactlyOnceWith(ORIGINAL079_DOWNLOAD, {
    signal: expect.any(AbortSignal),
    redirect: "error",
  });
  expect(ORIGINAL079_DOWNLOAD).toBe(
    "https://clawhub.ai/api/v1/packages/%40mcphersonai%2Fmcpherson-governance-openclaw/versions/0.8.0/artifact/download",
  );
});

it("refuses a transfer larger than the retained original archive", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array(191471))),
  );
  await expect(downloadOriginal079()).rejects.toThrow("archive exceeds retained size");
});

it("refuses same-size changed bytes after a bounded public transfer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array(191470))),
  );
  await expect(downloadOriginal079()).rejects.toThrow("archive identity mismatch");
});
import { execFileSync } from "node:child_process";
