/* @vitest-environment node */

import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import { createUiModuleMocks, makeGlobalOpts } from "../../../clawhub/test/cliCommandTestKit.js";

const ui = createUiModuleMocks();
vi.mock("../../../clawhub/src/cli/ui.js", () => ui.moduleFactory());
vi.mock("../../../clawhub/src/cli/authToken.js", () => ({
  requireAuthToken: async () => "transport-test-token",
}));
vi.mock("../../../clawhub/src/cli/registry.js", () => ({
  getRegistry: async (opts: GlobalOpts) => opts.registry,
}));

const {
  cmdBanUser,
  cmdUnbanUser,
  cmdLiftModerationHold,
  cmdSetRole,
  cmdRecoverPersonalPublisher,
  cmdRevokeSkillVersion,
  cmdReclassifyBan,
  cmdRescanSkill,
  cmdRescanAllSkills,
  cmdRescanAllPackages,
} = await import("./moderation");
const { cmdListPromotions } = await import("./promotions");

const recovery = {
  ok: true,
  dryRun: true,
  recovered: false,
  publisherId: "publisher-demo",
  handle: "demo",
  previousUser: {
    userId: "user-previous",
    handle: "demo",
    nextHandle: "demo-retired",
    githubProviderAccountId: "1",
    authAccountCount: 1,
  },
  nextUser: {
    userId: "user-current",
    handle: "current",
    nextHandle: "demo",
    githubProviderAccountId: "2",
    authAccountCount: 1,
  },
  retiredPersonalPublisher: null,
  resourceOwnerMigration: {
    limitPerTable: 100,
    skills: 1,
    skillSlugAliases: 0,
    packages: 0,
    packageInspectorWarnings: 0,
    githubSourcesChecked: 1,
    handleReservations: 0,
  },
  identityVerified: false,
  reason: "reviewed",
};

type Scenario = {
  name: string;
  run: (opts: GlobalOpts) => Promise<unknown>;
  response: Record<string, unknown>;
  success: string;
  logs?: string[];
};
const scenarios: Scenario[] = [
  {
    name: "ban",
    run: (opts) => cmdBanUser(opts, "demo", { yes: true }, false),
    response: { ok: true, alreadyBanned: false, deletedSkills: 1 },
    success: "OK. Banned @demo (deleted 1 skill)",
  },
  {
    name: "unban",
    run: (opts) => cmdUnbanUser(opts, "demo", { yes: true }, false),
    response: { ok: true, alreadyUnbanned: false, restoredSkills: 1 },
    success: "OK. Unbanned @demo (restored 1 skill)",
  },
  {
    name: "hold restoration",
    run: (opts) => cmdLiftModerationHold(opts, "demo", { yes: true, reason: "reviewed" }, false),
    response: { ok: true, alreadyCleared: false, restoredSkills: 1, scheduledSkills: false },
    success: "OK. Lifted moderation hold for @demo (restored 1 skill)",
  },
  {
    name: "role",
    run: (opts) => cmdSetRole(opts, "demo", "moderator", { yes: true }, false),
    response: { ok: true, role: "moderator" },
    success: "OK. @demo is now moderator",
  },
  {
    name: "publisher recovery plan",
    run: (opts) =>
      cmdRecoverPersonalPublisher(
        opts,
        "demo",
        {
          to: "current",
          previousGithubId: "1",
          nextGithubId: "2",
          reason: "reviewed",
        },
        false,
      ),
    response: recovery,
    success: "Dry run OK for @demo; @demo would retire to @demo-retired",
    logs: [
      "Owner rows: 1 skills, 0 skill aliases, 0 packages, 0 package warnings, 0 handle reservations (1 GitHub sources checked; limit 100/table).",
      "Re-run with --apply --verified --yes to write this recovery.",
    ],
  },
  {
    name: "revocation",
    run: (opts) =>
      cmdRevokeSkillVersion(
        opts,
        "demo",
        { yes: true, version: "1.2.3", reason: "reviewed" },
        false,
      ),
    response: {
      ok: true,
      slug: "demo",
      version: "1.2.3",
      skillId: "skill-demo",
      versionId: "version-demo",
      alreadyRevoked: false,
      replacementVersion: null,
      skillHidden: true,
    },
    success: "OK. Revoked demo@1.2.3",
  },
  {
    name: "ban reclassification plan",
    run: (opts) => cmdReclassifyBan(opts, "demo", { reason: "reviewed" }, false),
    response: {
      ok: true,
      dryRun: true,
      userId: "user-demo",
      handle: "demo",
      previousReason: null,
      nextReason: "reviewed",
      changed: true,
    },
    success: "Dry run ban reclassification for @demo: none -> reviewed.",
    logs: ["Re-run with --apply --yes to write this change."],
  },
  {
    name: "rescan submission",
    run: (opts) => cmdRescanSkill(opts, "demo", { yes: true }, false),
    response: {
      ok: true,
      scanId: "scan-demo",
      status: "queued",
      sourceKind: "published",
      update: true,
      alreadyQueued: false,
    },
    success: "OK. Queued ClawScan for demo (new job).",
  },
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

async function startRegistry(responses: unknown[]) {
  const requests: Array<{ method?: string; url?: string; body: unknown }> = [];
  server = createServer(async (request, reply) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({
      method: request.method,
      url: request.url,
      body: body ? JSON.parse(body) : null,
    });
    reply.writeHead(200, { "Content-Type": "application/json" });
    reply.end(JSON.stringify(responses.shift() ?? null));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  return { opts: { ...makeGlobalOpts(), registry: `http://127.0.0.1:${address.port}` }, requests };
}

describe("admin response validation through HTTP", () => {
  it.each(scenarios)("preserves $name output and rejects malformed responses", async (scenario) => {
    const response = { ...scenario.response, extension: "retained" };
    const { opts, requests } = await startRegistry([response, null]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await scenario.run(opts)).toEqual(response);
    expect(ui.spinner.succeed).toHaveBeenCalledWith(scenario.success);
    expect(log.mock.calls).toEqual((scenario.logs ?? []).map((line) => [line]));
    vi.clearAllMocks();

    await expect(scenario.run(opts)).rejects.toThrow("API response: an object");
    expect(ui.spinner.succeed).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(ui.spinner.fail).toHaveBeenCalledWith("API response: an object");
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
  });

  it("rejects malformed fuzzy search before a mutation", async () => {
    const result = { ok: true, alreadyBanned: false, deletedSkills: 1 };
    const { opts, requests } = await startRegistry([
      { items: [{ userId: "user-demo", handle: "demo" }], total: 1 },
      result,
      null,
    ]);
    expect(await cmdBanUser(opts, "demo", { yes: true, fuzzy: true }, false)).toEqual(result);
    expect(requests.map(({ method }) => method)).toEqual(["GET", "POST"]);
    expect(requests[1]?.body).toEqual({ userId: "user-demo" });
    requests.length = 0;
    vi.clearAllMocks();
    await expect(cmdBanUser(opts, "demo", { yes: true, fuzzy: true }, false)).rejects.toThrow(
      "API response: an object",
    );
    expect(requests).toEqual([{ method: "GET", url: "/api/v1/users?q=demo&limit=10", body: null }]);
    expect(ui.spinner.succeed).not.toHaveBeenCalled();
  });

  it.each([
    { name: "skills", run: cmdRescanAllSkills, sampleKey: "sampleSlugs" },
    { name: "packages", run: cmdRescanAllPackages, sampleKey: "sampleNames" },
  ])("validates $name batches and status before continuing", async ({ name, run, sampleKey }) => {
    const batch = {
      ok: true,
      mode: "all-active-latest",
      queued: 1,
      alreadyQueued: 0,
      skipped: 0,
      jobIds: ["job-demo"],
      nextCursor: "page-2",
      done: false,
      [sampleKey]: ["demo"],
    };
    const status = {
      ok: true,
      total: 1,
      queued: 0,
      running: 0,
      succeeded: 1,
      failed: 0,
      missing: 0,
      terminal: 1,
      done: true,
      failedJobIds: [],
    };
    const lastBatch = {
      ...batch,
      queued: 0,
      jobIds: [],
      nextCursor: null,
      done: true,
      [sampleKey]: [],
    };
    const responses: unknown[] = [batch, status, lastBatch];
    const { opts, requests } = await startRegistry(responses);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const options = { yes: true, json: true, pollInterval: 0 };
    const summary = {
      ok: true,
      batches: 2,
      queued: 1,
      alreadyQueued: 0,
      skipped: 0,
      failed: 0,
      cursor: null,
      dryRun: false,
    };
    expect(await run(opts, options, false)).toEqual(summary);
    const path = `/api/v1/${name}/-/scan/batch`;
    expect(requests.map(({ url }) => url)).toEqual([path, `${path}/status`, path]);
    expect(write.mock.calls.map(([value]) => JSON.parse(String(value)))).toEqual([
      {
        type: "batch",
        batch: 1,
        cursor: null,
        nextCursor: "page-2",
        queued: 1,
        alreadyQueued: 0,
        skipped: 0,
        done: false,
        [sampleKey]: ["demo"],
      },
      { type: "status", batch: 1, ...status },
      {
        type: "batch",
        batch: 2,
        cursor: "page-2",
        nextCursor: null,
        queued: 0,
        alreadyQueued: 0,
        skipped: 0,
        done: true,
        [sampleKey]: [],
      },
      { type: "summary", ...summary },
    ]);

    requests.length = 0;
    responses.push(null);
    vi.clearAllMocks();
    await expect(run(opts, options, false)).rejects.toThrow("API response: an object");
    expect(requests.map(({ url }) => url)).toEqual([path]);
    expect(write).not.toHaveBeenCalled();

    requests.length = 0;
    responses.push(batch, null);
    vi.clearAllMocks();
    await expect(run(opts, options, false)).rejects.toThrow("API response: an object");
    expect(requests.map(({ url }) => url)).toEqual([path, `${path}/status`]);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("collects promotion pages and emits nothing when a later page is malformed", async () => {
    const responses: unknown[] = [
      { promotions: [], nextCursor: "next page" },
      { promotions: [], nextCursor: null },
    ];
    const { opts, requests } = await startRegistry(responses);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await cmdListPromotions(opts, { all: true, json: true })).toEqual({ promotions: [] });
    expect(write).toHaveBeenCalledWith('{\n  "promotions": []\n}\n');
    expect(requests.map(({ url }) => url)).toEqual([
      "/api/v1/promotions?status=all&limit=100",
      "/api/v1/promotions?status=all&limit=100&cursor=next%20page",
    ]);
    requests.length = 0;
    responses.push({ promotions: [], nextCursor: "next page" }, null);
    vi.clearAllMocks();
    await expect(cmdListPromotions(opts, { all: true, json: true })).rejects.toThrow(
      "API response: an object",
    );
    expect(requests).toHaveLength(2);
    expect(write).not.toHaveBeenCalled();
  });
});
