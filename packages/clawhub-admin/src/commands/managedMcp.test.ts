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
