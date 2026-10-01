/* @vitest-environment node */

import { createServer } from "node:http";
import { afterEach, expect, it } from "vitest";
import { loadSmokeSkillFixture } from "./smokeSkillFixture";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
});

async function publicApi(owners: string[]) {
  const server = createServer((request, response) => {
    const url = new URL(request.url!, "http://localhost");
    const requestedOwner = url.searchParams.get("ownerHandle");
    const owner = requestedOwner || (owners.length === 1 ? owners[0] : undefined);
    response.setHeader("content-type", "application/json");
    if (!owner) {
      response.writeHead(409).end(
        JSON.stringify({
          code: "AMBIGUOUS_SKILL_SLUG",
          matches: owners.map((ownerHandle) => ({ ownerHandle, slug: "gifgrep" })),
        }),
      );
    } else if (!owners.includes(owner)) {
      response.writeHead(404).end("Skill not found");
    } else if (url.pathname.endsWith("/file")) {
      response.end(`SKILL.md published by ${owner}`);
    } else {
      response.end(
        JSON.stringify({
          skill: { slug: "gifgrep", displayName: "Gifgrep", summary: "Find GIFs" },
          latestVersion: { version: "1.0.0" },
          owner: { handle: owner },
        }),
      );
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing HTTP listener");
  return (path: string) => fetch(`http://127.0.0.1:${address.port}${path}`);
}

it("keeps the known production publisher when another publisher reuses the fixture slug", async () => {
  const request = await publicApi(["another-publisher", "steipete"]);
  const fixture = await loadSmokeSkillFixture(request, {});
  expect(fixture.owner.handle).toBe("steipete");
  const file = await request(fixture.filePath);
  expect(file.status).toBe(200);
  expect(await file.text()).toBe("SKILL.md published by steipete");
});

it.each(["test-snapshot-publisher-49771fa3ff44", "local-preview-owner"])(
  "uses the unique %s publisher for detail and file requests",
  async (owner) => {
    const request = await publicApi([owner]);
    const fixture = await loadSmokeSkillFixture(request, {});
    expect(fixture.owner.handle).toBe(owner);
    expect(await (await request(fixture.filePath)).text()).toBe(`SKILL.md published by ${owner}`);
  },
);

it("honors an explicit publisher even when the default production publisher exists", async () => {
  const request = await publicApi(["another-publisher", "steipete"]);
  const fixture = await loadSmokeSkillFixture(request, {
    CLAWHUB_E2E_SKILL_OWNER: "@another-publisher",
  });
  expect(fixture.owner.handle).toBe("another-publisher");
  expect(await (await request(fixture.filePath)).text()).toBe(
    "SKILL.md published by another-publisher",
  );
});

it("fails for a missing explicit publisher instead of switching to the available fixture", async () => {
  const request = await publicApi(["steipete"]);
  await expect(
    loadSmokeSkillFixture(request, { CLAWHUB_E2E_SKILL_OWNER: "missing" }),
  ).rejects.toThrow("Skill fixture @missing/gifgrep returned 404");
});

it("requires an owner override when none of the ambiguous choices is the known fixture", async () => {
  const request = await publicApi(["local-owner-one", "local-owner-two"]);
  await expect(loadSmokeSkillFixture(request, {})).rejects.toThrow(
    "set CLAWHUB_E2E_SKILL_OWNER explicitly",
  );
});
