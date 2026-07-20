/* @vitest-environment node */
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { SkillOrigin } from "./skills";
import {
  buildSkillFingerprint,
  extractGitHubZipPathToDir,
  extractZipToDir,
  hashSkillFiles,
  hashSkillZip,
  listManualSkills,
  listSkillFiles,
  listTextFiles,
  readLockfile,
  readSkillOrigin,
  sha256Hex,
  writeLockfile,
  writeSkillOrigin,
} from "./skills";

describe("skills", () => {
  it("extracts zip into directory and skips traversal", async () => {
    const parent = await mkdtemp(join(tmpdir(), "clawhub-zip-"));
    const dir = join(parent, "dir");
    await mkdir(dir);
    const evilName = `evil-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`;
    const zip = zipSync({
      "SKILL.md": strToU8("hello"),
      [`../${evilName}`]: strToU8("nope"),
    });
    await extractZipToDir(new Uint8Array(zip), dir);

    expect((await readFile(join(dir, "SKILL.md"), "utf8")).trim()).toBe("hello");
    await expect(stat(join(parent, evilName))).rejects.toBeTruthy();
  });

  it("extracts only the resolved GitHub skill folder from a repo zip", async () => {
    const parent = await mkdtemp(join(tmpdir(), "clawhub-github-zip-"));
    const dir = join(parent, "skill");
    const zip = zipSync({
      "skills-main/README.md": strToU8("repo readme"),
      "skills-main/skills/aiq-deploy/SKILL.md": strToU8("# AIQ Deploy"),
      "skills-main/skills/aiq-deploy/references/install.md": strToU8("install"),
      "skills-main/skills/other/SKILL.md": strToU8("# Other"),
    });

    await extractGitHubZipPathToDir(new Uint8Array(zip), dir, "skills/aiq-deploy");

    expect((await readFile(join(dir, "SKILL.md"), "utf8")).trim()).toBe("# AIQ Deploy");
    expect((await readFile(join(dir, "references/install.md"), "utf8")).trim()).toBe("install");
    await expect(stat(join(dir, "README.md"))).rejects.toBeTruthy();
    await expect(stat(join(dir, "skills/other/SKILL.md"))).rejects.toBeTruthy();
  });

  it("preserves GitHub skill filenames containing dot-dot text", async () => {
    const parent = await mkdtemp(join(tmpdir(), "clawhub-github-zip-"));
    const dir = join(parent, "skill");
    const zip = zipSync({
      "skills-main/skills/aiq-deploy/SKILL.md": strToU8("# AIQ Deploy"),
      "skills-main/skills/aiq-deploy/payload..sh": strToU8("echo safe"),
      "skills-main/skills/aiq-deploy/../payload.sh": strToU8("echo unsafe"),
    });

    await extractGitHubZipPathToDir(new Uint8Array(zip), dir, "skills/aiq-deploy");

    expect((await readFile(join(dir, "payload..sh"), "utf8")).trim()).toBe("echo safe");
    await expect(stat(join(parent, "payload.sh"))).rejects.toBeTruthy();
    await expect(stat(join(dir, "payload.sh"))).rejects.toBeTruthy();
  });

  it("writes and reads lockfile", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "clawhub-work-"));
    await writeLockfile(workdir, {
      version: 1,
      skills: {
        demo: {
          version: "1.0.0",
          installedAt: 1,
          pinned: true,
          pinReason: "awaiting moderation review",
        },
      },
    });
    const read = await readLockfile(workdir);
    expect(read.skills.demo?.version).toBe("1.0.0");
    expect(read.skills.demo?.pinned).toBe(true);
    expect(read.skills.demo?.pinReason).toBe("awaiting moderation review");
  });

  it("returns empty lockfile on invalid json", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "clawhub-work-bad-"));
    await mkdir(join(workdir, ".clawhub"), { recursive: true });
    await writeFile(join(workdir, ".clawhub", "lock.json"), "{", "utf8");
    const read = await readLockfile(workdir);
    expect(read).toEqual({ version: 1, skills: {} });
  });

  it("returns empty lockfile on schema mismatch", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "clawhub-work-schema-"));
    await mkdir(join(workdir, ".clawhub"), { recursive: true });
    await writeFile(
      join(workdir, ".clawhub", "lock.json"),
      JSON.stringify({ version: 1, skills: "nope" }),
      "utf8",
    );
    const read = await readLockfile(workdir);
    expect(read).toEqual({ version: 1, skills: {} });
  });

  it("skips dotfiles and node_modules when listing text files", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "clawhub-files-"));
    await writeFile(join(workdir, "SKILL.md"), "hi", "utf8");
    await writeFile(join(workdir, ".secret.txt"), "no", "utf8");
    await mkdir(join(workdir, ".clawhub"), { recursive: true });
    await writeFile(join(workdir, ".clawhub", "origin.json"), "{}", "utf8");
    await mkdir(join(workdir, "node_modules"), { recursive: true });
    await writeFile(join(workdir, "node_modules", "a.txt"), "no", "utf8");
    const files = await listSkillFiles(workdir);
    expect(files.map((file) => file.relPath)).toEqual(["SKILL.md"]);
  });

  it("respects .gitignore and .clawhubignore", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "clawhub-ignore-"));
    await writeFile(join(workdir, ".gitignore"), "ignored.md\n", "utf8");
    await writeFile(join(workdir, ".clawhubignore"), "private.md\n", "utf8");
    await writeFile(join(workdir, "SKILL.md"), "hi", "utf8");
    await writeFile(join(workdir, "ignored.md"), "no", "utf8");
    await writeFile(join(workdir, "private.md"), "no", "utf8");
    await writeFile(join(workdir, "public.json"), "{}", "utf8");

    const files = await listSkillFiles(workdir);
    const paths = files.map((file) => file.relPath).sort();
    expect(paths).toEqual(["SKILL.md", "public.json"]);
    expect(files.find((file) => file.relPath === "SKILL.md")?.contentType).toMatch(/^text\//);
    expect(files.find((file) => file.relPath === "public.json")?.contentType).toBe(
      "application/json",
    );
  });

  it("uses a generic MIME fallback for unknown extensions", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "clawhub-env-"));
    await writeFile(join(workdir, "SKILL.md"), "hi", "utf8");
    await writeFile(join(workdir, "config.env"), "SETTING=demo", "utf8");
    const files = await listTextFiles(workdir);
    expect(files.find((file) => file.relPath === "config.env")?.contentType).toBe(
      "application/octet-stream",
    );
  });

  it("includes every eligible regular file with exact bytes", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "clawhub-extensionless-"));
    await writeFile(join(workdir, "SKILL.md"), "hi", "utf8");
    await writeFile(join(workdir, "main.tf"), 'resource "null_resource" "demo" {}\n', "utf8");
    await writeFile(join(workdir, "terraform.tfvars"), 'region = "us-east-1"\n', "utf8");
    await writeFile(join(workdir, "config.tsv"), "name\tvalue\napi\tok\n", "utf8");
    await writeFile(join(workdir, ".npmrc"), "//registry.npmjs.org/:_authToken=secret\n", "utf8");
    await mkdir(join(workdir, "bin"), { recursive: true });
    await writeFile(
      join(workdir, "bin", "openclaw-kraken"),
      "#!/usr/bin/env sh\necho ok\n",
      "utf8",
    );
    const largeBinary = new Uint8Array(1024 * 1024);
    largeBinary[0] = 0;
    largeBinary[largeBinary.length - 1] = 255;
    await writeFile(join(workdir, "bin", "binary"), largeBinary);

    const files = await listSkillFiles(workdir);
    const paths = files.map((file) => file.relPath).sort();
    expect(paths).toEqual([
      "SKILL.md",
      "bin/binary",
      "bin/openclaw-kraken",
      "config.tsv",
      "main.tf",
      "terraform.tfvars",
    ]);
    expect(files.find((file) => file.relPath === "bin/openclaw-kraken")?.contentType).toBe(
      "application/octet-stream",
    );
    expect(files.find((file) => file.relPath === "bin/binary")?.bytes).toEqual(largeBinary);
  });

  it("checks publish limits before reading skill artifacts", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "clawhub-publish-limits-"));
    await writeFile(join(workdir, "SKILL.md"), "hi", "utf8");
    await writeFile(join(workdir, "payload.bin"), "12345", "utf8");

    await expect(listSkillFiles(workdir, { maxFileBytes: 4, maxTotalBytes: 100 })).rejects.toThrow(
      'File "payload.bin" exceeds 4 byte limit',
    );
    await expect(listSkillFiles(workdir, { maxFileBytes: 10, maxTotalBytes: 6 })).rejects.toThrow(
      "Skill bundle exceeds 6 byte limit",
    );
  });

  it("hashes skill files deterministically", async () => {
    const { fingerprint } = hashSkillFiles([
      { relPath: "b.txt", bytes: strToU8("b") },
      { relPath: "a.txt", bytes: strToU8("a") },
    ]);
    const expected = buildSkillFingerprint([
      { path: "a.txt", sha256: sha256Hex(strToU8("a")) },
      { path: "b.txt", sha256: sha256Hex(strToU8("b")) },
    ]);
    expect(fingerprint).toBe(expected);
  });

  it("hashes every eligible file inside a downloaded zip deterministically", () => {
    const opaqueBytes = Uint8Array.from([0, 1, 2, 255]);
    const zip = zipSync({
      "SKILL.md": strToU8("hello"),
      "notes.md": strToU8("world"),
      ".npmrc": strToU8("//registry.npmjs.org/:_authToken=secret\n"),
      "config/endpoints.tsv": strToU8("name\turl\napi\thttps://example.com\n"),
      "bin/tool": strToU8("#!/usr/bin/env sh\necho ok\n"),
      "main.tf": strToU8('resource "null_resource" "demo" {}\n'),
      "assets/payload.bin": opaqueBytes,
    });
    const { fingerprint } = hashSkillZip(new Uint8Array(zip));
    const expected = buildSkillFingerprint([
      { path: "SKILL.md", sha256: sha256Hex(strToU8("hello")) },
      { path: "assets/payload.bin", sha256: sha256Hex(opaqueBytes) },
      { path: "bin/tool", sha256: sha256Hex(strToU8("#!/usr/bin/env sh\necho ok\n")) },
      {
        path: "config/endpoints.tsv",
        sha256: sha256Hex(strToU8("name\turl\napi\thttps://example.com\n")),
      },
      {
        path: "main.tf",
        sha256: sha256Hex(strToU8('resource "null_resource" "demo" {}\n')),
      },
      { path: "notes.md", sha256: sha256Hex(strToU8("world")) },
    ]);
    expect(fingerprint).toBe(expected);
  });

  it("ignores unsafe entries when hashing zips", () => {
    const zip = zipSync({
      "SKILL.md": strToU8("hello"),
      "folder/": strToU8(""),
      "../evil.txt": strToU8("nope"),
      "bad\\path.txt": strToU8("nope"),
      "image.png": strToU8("included"),
    });
    const { files } = hashSkillZip(new Uint8Array(zip));
    expect(files).toEqual([
      { path: "SKILL.md", sha256: sha256Hex(strToU8("hello")), size: 5 },
      { path: "image.png", sha256: sha256Hex(strToU8("included")), size: 8 },
    ]);
  });

  it("builds fingerprints from valid entries only", () => {
    const fingerprint = buildSkillFingerprint([
      { path: "", sha256: "" },
      { path: "valid.txt", sha256: sha256Hex(strToU8("ok")) },
    ]);
    const expected = buildSkillFingerprint([
      { path: "valid.txt", sha256: sha256Hex(strToU8("ok")) },
    ]);
    expect(fingerprint).toBe(expected);
  });

  it("returns null for invalid skill origin metadata", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "clawhub-origin-"));
    expect(await readSkillOrigin(workdir)).toBeNull();

    await mkdir(join(workdir, ".clawhub"), { recursive: true });
    await writeFile(
      join(workdir, ".clawhub", "origin.json"),
      JSON.stringify({ version: 2 }),
      "utf8",
    );
    expect(await readSkillOrigin(workdir)).toBeNull();

    await writeFile(
      join(workdir, ".clawhub", "origin.json"),
      JSON.stringify({ version: 1, registry: "demo", slug: "x", installedAt: 1 }),
      "utf8",
    );
    expect(await readSkillOrigin(workdir)).toBeNull();

    await writeFile(
      join(workdir, ".clawhub", "origin.json"),
      JSON.stringify({
        version: 1,
        registry: "demo",
        slug: "x",
        installedVersion: "0.1.0",
        installedAt: "nope",
      }),
      "utf8",
    );
    expect(await readSkillOrigin(workdir)).toBeNull();

    const origin: SkillOrigin = {
      version: 1,
      registry: "https://example.com",
      slug: "demo",
      installedVersion: "1.2.3",
      installedAt: 123,
    };
    await writeSkillOrigin(workdir, origin);
    expect(await readSkillOrigin(workdir)).toEqual(origin);
  });

  describe("listManualSkills", () => {
    it("lists manual skills not present in the lockfile", async () => {
      const dir = await mkdtemp(join(tmpdir(), "clawhub-manual-"));
      await mkdir(join(dir, "manual-skill"));
      await writeFile(join(dir, "manual-skill", "SKILL.md"), "# Manual", "utf8");

      await mkdir(join(dir, "tracked-skill"));
      await writeFile(join(dir, "tracked-skill", "SKILL.md"), "# Tracked", "utf8");

      const result = await listManualSkills(dir, new Set(["tracked-skill"]));
      expect(result).toEqual(["manual-skill"]);
    });

    it("recognizes skills from current and legacy origin metadata", async () => {
      const dir = await mkdtemp(join(tmpdir(), "clawhub-manual-origin-"));
      await mkdir(join(dir, "current", ".clawhub"), { recursive: true });
      await writeFile(join(dir, "current", ".clawhub", "origin.json"), "{}", "utf8");
      await mkdir(join(dir, "legacy", ".clawdhub"), { recursive: true });
      await writeFile(join(dir, "legacy", ".clawdhub", "origin.json"), "{}", "utf8");

      const result = await listManualSkills(dir, new Set());
      expect(result).toEqual(["current", "legacy"]);
    });

    it("skips hidden and non-skill directories and returns sorted results", async () => {
      const dir = await mkdtemp(join(tmpdir(), "clawhub-manual-sort-"));
      await mkdir(join(dir, "z-skill"));
      await writeFile(join(dir, "z-skill", "SKILL.md"), "# Z", "utf8");
      await mkdir(join(dir, "a-skill"));
      await writeFile(join(dir, "a-skill", "SKILL.md"), "# A", "utf8");
      await mkdir(join(dir, ".hidden"));
      await writeFile(join(dir, ".hidden", "SKILL.md"), "# Hidden", "utf8");
      await mkdir(join(dir, "notes"));
      await writeFile(join(dir, "notes", "README.md"), "not a skill", "utf8");

      const result = await listManualSkills(dir, new Set());
      expect(result).toEqual(["a-skill", "z-skill"]);
    });

    it("returns an empty list when the skills directory does not exist", async () => {
      const dir = await mkdtemp(join(tmpdir(), "clawhub-manual-missing-"));
      const result = await listManualSkills(join(dir, "missing"), new Set());
      expect(result).toEqual([]);
    });
  });
});
