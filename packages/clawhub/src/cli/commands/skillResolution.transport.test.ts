/* @vitest-environment node */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUiModuleMocks, makeGlobalOpts } from "../../../test/cliCommandTestKit.js";
import type { GlobalOpts } from "../types.js";

const ui = createUiModuleMocks();
let token: string | undefined;
const transportErrors: unknown[] = [];
vi.mock("../ui.js", async () => {
  const actual = await vi.importActual<typeof import("../ui.js")>("../ui.js");
  return { ...actual, ...ui.moduleFactory(), formatError: actual.formatError };
});
vi.mock("../authToken.js", () => ({ getOptionalAuthToken: async () => token }));
vi.mock("../registry.js", () => ({ getRegistry: async (opts: GlobalOpts) => opts.registry }));
vi.mock("../../http.js", async () => {
  const actual = await vi.importActual<typeof import("../../http.js")>("../../http.js");
  return {
    ...actual,
    apiRequest: async (...args: Parameters<typeof actual.apiRequest>) => {
      try {
        return await actual.apiRequest(...args);
      } catch (error) {
        transportErrors.push(error);
        throw error;
      }
    },
  };
});

const { cmdPublish, prepareSkillFilesForPublish } = await import("./publish");
const { checkRegistrySyncState } = await import("./syncHelpers");
const { hashSkillFiles } = await import("../../skills");

let server: Server | undefined;
let workdir: string | undefined;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
    server = undefined;
  }
  if (workdir) await rm(workdir, { recursive: true, force: true });
  workdir = undefined;
  token = undefined;
  transportErrors.length = 0;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const cases = [
  {
    name: "matching revision",
    status: 200,
    body: { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } },
    publish: "unchanged",
    sync: "synced",
    version: "1.2.3",
  },
  {
    name: "changed revision",
    status: 200,
    body: { match: null, latestVersion: { version: "1.2.3" } },
    publish: "would-publish",
    sync: "update",
    version: "1.2.4",
  },
  {
    name: "new skill",
    status: 200,
    body: { match: null, latestVersion: null },
    publish: "would-publish",
    sync: "new",
    version: "1.0.0",
  },
  {
    name: "HTTP 404",
    status: 404,
    body: "",
    publish: "would-publish",
    sync: "new",
    version: "1.0.0",
  },
  {
    name: "legacy missing-skill error",
    status: 400,
    body: "Skill not found",
    publish: "would-publish",
    sync: "new",
    version: "1.0.0",
  },
  { name: "404 with unrelated detail", status: 404, body: "Missing", error: true },
  { name: "other HTTP error", status: 400, body: "Request rejected", error: true },
  {
    name: "invalid response shape",
    status: 200,
    body: { match: "invalid", latestVersion: null },
    error: true,
  },
  { name: "invalid JSON", status: 200, body: "{", error: true },
] as const;

describe.each(["publish", "sync"] as const)("%s skill resolution through HTTP", (caller) => {
  it.each(cases)("preserves $name behavior", async (fixture) => {
    workdir = await mkdtemp(join(tmpdir(), "clawhub-resolution-"));
    await writeFile(join(workdir, "SKILL.md"), "# Resolver fixture\n");
    const slug = "demo + 雪";
    const owner = fixture.name === "new skill" ? undefined : "owner + 雪";
    token = owner ? "resolver-test-token" : undefined;
    const fingerprint = hashSkillFiles(await prepareSkillFilesForPublish(workdir)).fingerprint;
    const requests: Array<{ method?: string; url?: string; authorization?: string }> = [];
    server = createServer((request, response) => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
      });
      response.writeHead(fixture.status, { "Content-Type": "application/json" });
      response.end(typeof fixture.body === "string" ? fixture.body : JSON.stringify(fixture.body));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    const registry = `http://127.0.0.1:${address.port}/tenant${caller === "publish" ? "/" : ""}`;
    const skill = {
      folder: workdir,
      slug,
      displayName: "Resolver fixture",
      fingerprint,
      fileCount: 1,
      origin: null,
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const result =
      caller === "publish"
        ? cmdPublish({ ...makeGlobalOpts(workdir), registry }, ".", {
            slug,
            owner,
            dryRun: true,
            quiet: true,
          })
        : checkRegistrySyncState(registry, skill, owner, token);
    if ("error" in fixture) {
      const error = await result.catch((caught: unknown) => caught);
      expect(transportErrors).toHaveLength(1);
      expect(error).toBe(transportErrors[0]);
    } else {
      const value = await result;
      expect(value.status).toBe(caller === "publish" ? fixture.publish : fixture.sync);
      if (caller === "publish") expect(value).toMatchObject({ version: fixture.version });
      else
        expect(value).toMatchObject({
          ...skill,
          latestVersion: fixture.sync === "new" ? null : "1.2.3",
          matchVersion: fixture.sync === "synced" ? "1.2.3" : null,
        });
    }
    const query = new URLSearchParams({ slug });
    if (caller === "publish" && owner) query.set("ownerHandle", owner);
    query.set("hash", fingerprint);
    if (caller === "sync" && owner) query.set("ownerHandle", owner);
    expect(requests).toEqual(
      Array.from({ length: fixture.name === "invalid JSON" ? 3 : 1 }, () => ({
        method: "GET",
        url: `/tenant/api/v1/resolve?${query.toString()}`,
        authorization: token ? `Bearer ${token}` : undefined,
      })),
    );
    expect(log).not.toHaveBeenCalled();
  });
});
