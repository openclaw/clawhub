/* @vitest-environment node */

import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUiModuleMocks, makeGlobalOpts } from "../../../test/cliCommandTestKit.js";
import type { GlobalOpts } from "../types.js";

const ui = createUiModuleMocks();
vi.mock("../ui.js", () => ui.moduleFactory());
vi.mock("../authToken.js", () => ({ requireAuthToken: async () => "transport-test-token" }));
vi.mock("../registry.js", () => ({ getRegistry: async (opts: GlobalOpts) => opts.registry }));

const { cmdDeleteSkill, cmdUndeleteSkill, cmdHideSkill, cmdUnhideSkill } = await import("./delete");
const { cmdRenameSkill, cmdMergeSkill, cmdSetSkillTag } = await import("./ownership");
const {
  cmdTransferRequest,
  cmdTransferList,
  cmdTransferAccept,
  cmdTransferReject,
  cmdTransferCancel,
} = await import("./transfer");

type Scenario = {
  name: string;
  run: (opts: GlobalOpts) => Promise<unknown>;
  response: Record<string, unknown>;
  success?: string;
  log?: string;
};

const scenarios: Scenario[] = [
  {
    name: "delete",
    run: (opts) => cmdDeleteSkill(opts, "demo", { yes: true }, false),
    response: { ok: true, slugReservedUntil: 1_700_086_400_000 },
    success: "OK. Deleted demo. Slug reserved until 2023-11-15T22:13:20.000Z",
  },
  {
    name: "undelete",
    run: (opts) => cmdUndeleteSkill(opts, "demo", { yes: true }, false),
    response: { ok: true },
    success: "OK. Undeleted demo",
  },
  {
    name: "hide",
    run: (opts) => cmdHideSkill(opts, "demo", { yes: true }, false),
    response: { ok: true },
    success: "OK. Hidden demo",
  },
  {
    name: "unhide",
    run: (opts) => cmdUnhideSkill(opts, "demo", { yes: true }, false),
    response: { ok: true },
    success: "OK. Unhidden demo",
  },
  {
    name: "rename",
    run: (opts) => cmdRenameSkill(opts, "demo", "renamed", { yes: true }, false),
    response: { ok: true, slug: "renamed", previousSlug: "demo" },
    success: "Renamed demo to renamed",
  },
  {
    name: "merge",
    run: (opts) => cmdMergeSkill(opts, "demo", "target", { yes: true }, false),
    response: { ok: true, sourceSlug: "demo", targetSlug: "target" },
    success: "Merged demo into target",
  },
  {
    name: "tag",
    run: (opts) => cmdSetSkillTag(opts, "demo", "1.2.3", { yes: true }, false),
    response: { ok: true, slug: "demo", tag: "latest", version: "1.2.3" },
    success: "Set latest for demo to 1.2.3",
  },
  {
    name: "transfer request",
    run: (opts) => cmdTransferRequest(opts, "demo", "alice", { yes: true }, false),
    response: { ok: true, transferId: "transfer-1", toUserHandle: "alice" },
    success: "Transfer requested for demo to @alice",
  },
  {
    name: "transfer list",
    run: (opts) => cmdTransferList(opts, {}),
    response: { transfers: [] },
    log: "No incoming transfers.",
  },
  ...(
    [
      ["accept", cmdTransferAccept, "Transfer accepted"],
      ["reject", cmdTransferReject, "Transfer rejected"],
      ["cancel", cmdTransferCancel, "Transfer cancelled"],
    ] as const
  ).map(([name, command, message]) => ({
    name: `transfer ${name}`,
    run: (opts: GlobalOpts) => command(opts, "demo", { yes: true }, false),
    response: { ok: true, skillSlug: "demo" },
    success: `${message} (demo)`,
  })),
];

let server: Server | undefined;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
    server = undefined;
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("command responses through the HTTP client", () => {
  it.each(scenarios)("validates $name before reporting success", async (scenario) => {
    let response: unknown = { ...scenario.response, extension: "retained" };
    const requests: string[] = [];
    server = createServer(async (request, reply) => {
      for await (const _chunk of request) {
        // Consume the request body before replying, as a registry would.
      }
      requests.push(`${request.method} ${request.url}`);
      requests.push(request.headers.authorization ?? "");
      reply.writeHead(200, { "Content-Type": "application/json" });
      reply.end(JSON.stringify(response));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    const opts = { ...makeGlobalOpts(), registry: `http://127.0.0.1:${address.port}` };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await scenario.run(opts)).toEqual(response);
    if (scenario.success) expect(ui.spinner.succeed).toHaveBeenCalledWith(scenario.success);
    else expect(ui.spinner.succeed).not.toHaveBeenCalled();
    expect(log.mock.calls).toEqual(scenario.log ? [[scenario.log]] : []);
    expect(ui.spinner.fail).not.toHaveBeenCalled();

    vi.clearAllMocks();
    response = null;
    let error: unknown;
    try {
      await scenario.run(opts);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("API response: an object");
    expect(ui.spinner.fail).toHaveBeenCalledWith((error as Error).message);
    expect(ui.spinner.succeed).not.toHaveBeenCalled();
    expect(ui.spinner.stop).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(requests).toHaveLength(4);
    expect(requests[0]).toBe(requests[2]);
    expect(requests[1]).toBe("Bearer transport-test-token");
    expect(requests[3]).toBe(requests[1]);
  });
});
