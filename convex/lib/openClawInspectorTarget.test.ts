/* @vitest-environment node */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareOpenClawInspectorTarget } from "./openClawInspectorTarget";

type TarEntry = { name: string; body: string; typeflag?: string; prefix?: string };

function tarHeader(name: string, size: number, typeflag: string, prefix = "") {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  header.write("00000000000\0", 136);
  header.write("        ", 148);
  header.write(typeflag, 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  header.write(prefix, 345, 155, "utf8");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
  return header;
}

function tgz(entries: TarEntry[]) {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body);
    blocks.push(tarHeader(entry.name, body.byteLength, entry.typeflag ?? "0", entry.prefix));
    blocks.push(body, Buffer.alloc((512 - (body.byteLength % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function paxRecord(key: string, value: string) {
  const suffix = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(suffix) + 1;
  while (Buffer.byteLength(`${length}${suffix}`) !== length) length += 1;
  return `${length}${suffix}`;
}

const packageJson = JSON.stringify({ name: "openclaw", version: "2026.9.7" });
const longDeclarationPath = `package/dist/${"nested/".repeat(20)}überdeep.d.ts`;

function urlOf(input: string | URL | Request) {
  return input instanceof Request ? input.url : input.toString();
}

function registryFetch(archive: Buffer, integrity = `sha512-${sha512(archive)}`) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = urlOf(input);
    if (url === "https://registry.npmjs.org/openclaw/latest") {
      return Response.json({
        name: "openclaw",
        version: "2026.9.7",
        dist: { tarball: "https://registry.npmjs.org/openclaw/-/openclaw-2026.9.7.tgz", integrity },
      });
    }
    if (url === "https://registry.npmjs.org/openclaw/-/openclaw-2026.9.7.tgz") {
      return new Response(new Uint8Array(archive));
    }
    return new Response("not found", { status: 404 });
  });
}

function sha512(bytes: Buffer) {
  return createHash("sha512").update(bytes).digest("base64");
}

const roots: string[] = [];
async function cacheRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "clawhub-openclaw-target-test-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("prepareOpenClawInspectorTarget", () => {
  it("extracts only the verified packed plugin surface and reuses it", async () => {
    const pax = paxRecord("mtime", "1790740000.5") + paxRecord("path", longDeclarationPath);
    const fetchImpl = registryFetch(
      tgz([
        { name: "package/package.json", body: packageJson },
        { name: "api.d.ts", prefix: "package/dist", body: "export type OpenClawPluginApi = {};" },
        { name: "PaxHeader", typeflag: "x", body: pax },
        { name: "package/dist/truncated-name.d.ts", body: "export type PluginHookName = 'x';" },
        { name: "package/dist/index.js", body: "console.log('runtime');" },
        { name: "package/README.md", body: "# OpenClaw" },
      ]),
    );
    const readTargetSurface = vi.fn(async ({ rootDir }: { rootDir: string }) => ({
      status: "ok",
      hookNames: ["x"],
      rootDir,
    }));
    const root = await cacheRoot();
    const deps = { fetch: fetchImpl, readTargetSurface, eligibilityVersion: (v: string) => v };

    const target = await prepareOpenClawInspectorTarget(root, deps);
    expect(await prepareOpenClawInspectorTarget(root, deps)).toBe(target);

    expect(target).toMatchObject({
      status: "ok",
      version: "2026.9.7",
      configuredPath: "npm:openclaw@2026.9.7",
      requestedVersion: "latest",
      source: { type: "npm", package: "openclaw", distTag: "latest" },
      cache: { hit: false },
    });
    const packageDir = readTargetSurface.mock.calls[0]?.[0].rootDir as string;
    expect(await readdir(packageDir)).toEqual(["dist", "package.json"]);
    expect(await readFile(path.join(packageDir, "dist/api.d.ts"), "utf8")).toContain(
      "OpenClawPluginApi",
    );
    expect(existsSync(path.join(packageDir, longDeclarationPath.slice("package/".length)))).toBe(
      true,
    );
    expect(existsSync(path.join(packageDir, "dist/truncated-name.d.ts"))).toBe(false);
    expect(existsSync(path.join(packageDir, "dist/index.js"))).toBe(false);
    expect(fetchImpl.mock.calls.filter(([url]) => urlOf(url).endsWith(".tgz"))).toHaveLength(1);
  });

  it("reuses a verified target that an earlier process left on disk", async () => {
    const archive = tgz([
      { name: "package/package.json", body: packageJson },
      { name: "package/dist/api.d.ts", body: "export {};" },
    ]);
    const root = await cacheRoot();
    const deps = (fetchImpl: typeof fetch) => ({
      fetch: fetchImpl,
      readTargetSurface: async () => ({ status: "ok" }),
      eligibilityVersion: (v: string) => v,
    });
    const first = await prepareOpenClawInspectorTarget(root, deps(registryFetch(archive)));
    vi.resetModules();
    const fresh = await import("./openClawInspectorTarget");
    const fetchAgain = registryFetch(archive);
    const again = await fresh.prepareOpenClawInspectorTarget(root, deps(fetchAgain));

    expect(first.cache).toMatchObject({ hit: false });
    expect(again.cache).toMatchObject({ hit: true });
    expect(fetchAgain.mock.calls.some(([url]) => urlOf(url).endsWith(".tgz"))).toBe(false);
  });

  it("rejects an archive whose bytes do not match npm integrity", async () => {
    const root = await cacheRoot();
    const archive = tgz([{ name: "package/package.json", body: packageJson }]);
    await expect(
      prepareOpenClawInspectorTarget(root, {
        fetch: registryFetch(archive, `sha512-${sha512(Buffer.from("other"))}`),
        readTargetSurface: async () => ({ status: "ok" }),
        eligibilityVersion: (v: string) => v,
      }),
    ).rejects.toThrow("failed integrity verification");
    expect(existsSync(path.join(root, "openclaw"))).toBe(false);
  });

  it("rejects traversal in selected surface paths", async () => {
    const root = await cacheRoot();
    await expect(
      prepareOpenClawInspectorTarget(root, {
        fetch: registryFetch(
          tgz([
            { name: "package/package.json", body: packageJson },
            { name: "package/dist/../../escape.d.ts", body: "export {};" },
          ]),
        ),
        readTargetSurface: async () => ({ status: "ok" }),
        eligibilityVersion: (v: string) => v,
      }),
    ).rejects.toThrow("unsafe path");
  });
});
