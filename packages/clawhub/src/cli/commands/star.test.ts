/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  createUiModuleMocks,
  makeGlobalOpts,
} from "../../../test/cliCommandTestKit.js";
import { ApiV1StarResponseSchema, ApiV1UnstarResponseSchema } from "../../schema/index.js";

const authTokenMocks = createAuthTokenModuleMocks();
const registryMocks = createRegistryModuleMocks();
const httpMocks = createHttpModuleMocks();
const uiMocks = createUiModuleMocks();
const isInteractive = vi.fn(() => true);
const createCrabLoader = vi.fn(() => uiMocks.spinner);

vi.mock("../authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../registry.js", () => registryMocks.moduleFactory());
vi.mock("../../http.js", () => httpMocks.moduleFactory());
vi.mock("../ui.js", () => ({ ...uiMocks.moduleFactory(), isInteractive, createCrabLoader }));

const { cmdStarSkill } = await import("./star");
const { cmdUnstarSkill } = await import("./unstar");

beforeEach(() => {
  vi.clearAllMocks();
  isInteractive.mockReturnValue(true);
  uiMocks.promptConfirm.mockResolvedValue(true);
});

const commands = [
  {
    name: "star",
    run: cmdStarSkill,
    verb: "Star",
    progress: "Starring",
    method: "POST",
    schema: ApiV1StarResponseSchema,
    result: (already: boolean) => ({ ok: true, starred: true, alreadyStarred: already }),
    success: "OK. Starred demo",
    already: "OK. demo already starred.",
  },
  {
    name: "unstar",
    run: cmdUnstarSkill,
    verb: "Unstar",
    progress: "Unstarring",
    method: "DELETE",
    schema: ApiV1UnstarResponseSchema,
    result: (already: boolean) => ({ ok: true, unstarred: true, alreadyUnstarred: already }),
    success: "OK. Unstarred demo",
    already: "OK. demo already unstarred.",
  },
];

describe.each(commands)("$name command", (command) => {
  it.each([false, true])("returns the response and reports idempotence %s", async (already) => {
    const result = command.result(already);
    httpMocks.apiRequest.mockResolvedValueOnce(result);
    expect(await command.run(makeGlobalOpts(), "demo", { yes: true }, false)).toBe(result);
    expect(httpMocks.apiRequest).toHaveBeenCalledExactlyOnceWith(
      "https://clawhub.ai",
      { method: command.method, path: "/api/v1/stars/demo", token: "tkn" },
      command.schema,
    );
    expect(isInteractive).toHaveBeenCalledOnce();
    expect(uiMocks.promptConfirm).not.toHaveBeenCalled();
    expect(createCrabLoader).toHaveBeenCalledExactlyOnceWith(`${command.progress} demo`);
    expect(uiMocks.spinner.succeed).toHaveBeenCalledExactlyOnceWith(
      already ? command.already : command.success,
    );
  });

  it("confirms before selecting the registry, authenticating and requesting", async () => {
    const opts = makeGlobalOpts();
    httpMocks.apiRequest.mockResolvedValueOnce(command.result(false));
    await command.run(opts, "@OpenClaw/Demo", {}, true);
    expect(uiMocks.promptConfirm).toHaveBeenCalledExactlyOnceWith(`${command.verb} demo?`);
    expect(registryMocks.getRegistry).toHaveBeenCalledExactlyOnceWith(opts, { cache: true });
    expect(authTokenMocks.requireAuthToken).toHaveBeenCalledExactlyOnceWith("https://clawhub.ai");
    expect(httpMocks.apiRequest).toHaveBeenCalledExactlyOnceWith(
      "https://clawhub.ai",
      {
        method: command.method,
        url: "https://clawhub.ai/api/v1/stars/demo?ownerHandle=openclaw",
        token: "tkn",
      },
      command.schema,
    );
    const order = [
      uiMocks.promptConfirm,
      registryMocks.getRegistry,
      authTokenMocks.requireAuthToken,
      createCrabLoader,
      httpMocks.apiRequest,
    ].map((mock) => mock.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("returns undefined on a declined confirmation without acquiring resources", async () => {
    uiMocks.promptConfirm.mockResolvedValueOnce(false);
    expect(await command.run(makeGlobalOpts(), "demo", {}, true)).toBeUndefined();
    expect(registryMocks.getRegistry).not.toHaveBeenCalled();
    expect(authTokenMocks.requireAuthToken).not.toHaveBeenCalled();
    expect(createCrabLoader).not.toHaveBeenCalled();
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("preserves registry base paths and escaped owner-qualified references", async () => {
    registryMocks.getRegistry.mockResolvedValueOnce("https://example.com/registry/");
    httpMocks.apiRequest.mockResolvedValueOnce(command.result(false));
    await command.run(makeGlobalOpts(), "@Öwner/Demo ?#", { yes: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledExactlyOnceWith(
      "https://example.com/registry/",
      {
        method: command.method,
        url: "https://example.com/registry/api/v1/stars/demo%20%3F%23?ownerHandle=%C3%B6wner",
        token: "tkn",
      },
      command.schema,
    );
  });

  it.each([
    { interactive: false, inputAllowed: true },
    { interactive: true, inputAllowed: false },
  ])("requires --yes when confirmation is unavailable: %j", async (mode) => {
    isInteractive.mockReturnValueOnce(mode.interactive);
    await expect(command.run(makeGlobalOpts(), "demo", {}, mode.inputAllowed)).rejects.toThrow(
      "Pass --yes (no input)",
    );
    expect(uiMocks.promptConfirm).not.toHaveBeenCalled();
    expect(registryMocks.getRegistry).not.toHaveBeenCalled();
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("propagates authentication failure before creating a loader", async () => {
    const error = new Error("authentication fixture failure");
    authTokenMocks.requireAuthToken.mockRejectedValueOnce(error);
    await expect(command.run(makeGlobalOpts(), "demo", { yes: true }, false)).rejects.toBe(error);
    expect(createCrabLoader).not.toHaveBeenCalled();
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("reports request failure through the loader and preserves the error", async () => {
    const error = new Error("request fixture failure");
    httpMocks.apiRequest.mockRejectedValueOnce(error);
    await expect(command.run(makeGlobalOpts(), "demo", { yes: true }, false)).rejects.toBe(error);
    expect(uiMocks.spinner.fail).toHaveBeenCalledExactlyOnceWith(error.message);
    expect(uiMocks.spinner.succeed).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "owner/", "/slug", "owner/slug/extra"])(
    "rejects invalid reference %j before confirmation or authentication",
    async (input) => {
      await expect(command.run(makeGlobalOpts(), input, { yes: true }, false)).rejects.toThrow(
        input.trim() ? "Invalid skill ref: " + input : "Skill required",
      );
      expect(isInteractive).not.toHaveBeenCalled();
      expect(registryMocks.getRegistry).not.toHaveBeenCalled();
      expect(authTokenMocks.requireAuthToken).not.toHaveBeenCalled();
      expect(httpMocks.apiRequest).not.toHaveBeenCalled();
    },
  );
});
