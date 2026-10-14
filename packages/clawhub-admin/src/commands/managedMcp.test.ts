/* @vitest-environment node */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  makeGlobalOpts,
} from "../../../clawhub/test/cliCommandTestKit.js";
const auth = createAuthTokenModuleMocks();
const http = createHttpModuleMocks();
const registry = createRegistryModuleMocks();
vi.mock("../../../clawhub/src/cli/authToken.js", () => auth.moduleFactory());
vi.mock("../../../clawhub/src/http.js", () => http.moduleFactory());
vi.mock("../../../clawhub/src/cli/registry.js", () => registry.moduleFactory());
const { cmdPublishManagedMcp, cmdUnpublishManagedMcp } = await import("./managedMcp.js");
const directories: string[] = [];
const definition = {
  id: "example",
  name: "Example",
  company: "Example",
  description: "Example service.",
  category: "integrations",
  version: "1.0.0",
  icon: { pngBase64: "iVBORw0KGgo=", license: "MIT", attribution: "OpenClaw" },
  connection: {
    url: "https://mcp.example.com/mcp",
    transport: "streamable-http",
    auth: { kind: "none" },
  },
};
async function input(value: unknown) {
  const dir = await mkdtemp(join(tmpdir(), "managed-mcp-test-"));
  directories.push(dir);
  const file = join(dir, "input.json");
  await writeFile(file, JSON.stringify(value));
  return file;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.clearAllMocks();
});
describe("managed MCP admin CLI", () => {
  it("uploads a local icon with the definition's rights metadata", async () => {
    const { pngBase64: _png, ...rights } = definition.icon;
    const file = await input({
      ...definition,
      icon: {
        ...rights,
        license: "Provider brand terms",
        sourceUrl: "https://example.com/brand/icon.png",
        licenseUrl: "https://example.com/brand",
      },
    });
    const icon = `${file}.png`;
    await writeFile(icon, Buffer.from(definition.icon.pngBase64, "base64"));
    await cmdPublishManagedMcp(makeGlobalOpts(), file, { icon });
    expect(http.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        body: expect.objectContaining({
          icon: expect.objectContaining({
            pngBase64: definition.icon.pngBase64,
            license: "Provider brand terms",
            sourceUrl: "https://example.com/brand/icon.png",
            licenseUrl: "https://example.com/brand",
          }),
        }),
      }),
      undefined,
    );
  });

  it("refuses to apply one local icon to a batch", async () => {
    await expect(
      cmdPublishManagedMcp(makeGlobalOpts(), await input([definition]), { icon: "icon.png" }),
    ).rejects.toThrow("--icon requires a single definition");
    expect(auth.requireAuthToken).not.toHaveBeenCalled();
  });

  it("rejects oversized local icons before authentication", async () => {
    const file = await input(definition);
    const icon = `${file}.png`;
    await writeFile(icon, Buffer.alloc(512 * 1024 + 1));
    await expect(cmdPublishManagedMcp(makeGlobalOpts(), file, { icon })).rejects.toThrow("512KB");
    expect(auth.requireAuthToken).not.toHaveBeenCalled();
  });

  it("rejects non-regular icon inputs before reading their contents", async () => {
    const file = await input(definition);
    await expect(
      cmdPublishManagedMcp(makeGlobalOpts(), file, { icon: directories.at(-1) }),
    ).rejects.toThrow("regular PNG file");
    expect(auth.requireAuthToken).not.toHaveBeenCalled();
  });

  it("validates the whole batch before any authenticated publication", async () => {
    const file = await input([
      definition,
      {
        ...definition,
        id: "second",
        connection: {
          ...definition.connection,
          url: "https://mcp.example.com?token=never-publish",
        },
      },
    ]);
    await expect(cmdPublishManagedMcp(makeGlobalOpts(), file, {})).rejects.toThrow(
      "must not contain credentials",
    );
    expect(auth.requireAuthToken).not.toHaveBeenCalled();
    expect(http.apiRequest).not.toHaveBeenCalled();
  });
  it("rejects duplicate identities before publication", async () => {
    await expect(
      cmdPublishManagedMcp(makeGlobalOpts(), await input([definition, definition]), {}),
    ).rejects.toThrow("Duplicate integration ids");
    expect(http.apiRequest).not.toHaveBeenCalled();
  });
  it("uses the normal admin endpoint for every entry and unpublish", async () => {
    await cmdPublishManagedMcp(makeGlobalOpts(), await input(definition), {});
    expect(http.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/packages/-/managed-mcp",
        token: "tkn",
        body: definition,
      }),
      undefined,
    );
    await cmdUnpublishManagedMcp(makeGlobalOpts(), "example");
    expect(http.apiRequest).toHaveBeenLastCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/packages/-/managed-mcp/example/unpublish",
        token: "tkn",
      }),
      undefined,
    );
  });
});
