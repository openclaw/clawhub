import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const exec = promisify(execFile);
test.skip(process.env.VITE_ENABLE_DEV_AUTH !== "1", "Requires the isolated local-auth runner");

test("compiled package SSR preserves viewer isolation and rejects revoked tokens", async ({
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const config = JSON.parse(readFileSync(".convex/local/default/config.json", "utf8")) as {
    deploymentName: string;
  };
  for (const value of [process.env.VITE_CONVEX_URL, process.env.VITE_CONVEX_SITE_URL]) {
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(value!).hostname);
  }
  const env = { ...process.env, CONVEX_DEPLOYMENT: `local:${config.deploymentName}` };
  const run = async <T = void>(args: string[]): Promise<T> => {
    const result = await exec(
      "bunx",
      ["convex", "run", "--typecheck", "disable", "--codegen", "disable", ...args],
      { env },
    );
    const output = result.stdout.trim();
    return (output ? JSON.parse(output) : undefined) as T;
  };
  const suffix = `${Date.now().toString(36)}-${testInfo.workerIndex}`;
  const privateName = `ssr-private-${suffix}`;
  const privateMarker = `Private SSR content ${suffix}`;
  const publicName = `ssr-public-${suffix}`;
  const ownerHandle = `ssr-owner-${suffix}`;
  const otherHandle = `ssr-other-${suffix}`;
  await run([
    "devSeed:seedPublicCorpusBatch",
    JSON.stringify({
      rows: [
        { name: privateName, displayName: privateMarker, channel: "private", handle: ownerHandle },
        {
          name: publicName,
          displayName: `Public SSR content ${suffix}`,
          channel: "community",
          handle: otherHandle,
        },
      ].map(({ handle, ...row }) => ({
        ...row,
        kind: "plugin",
        version: "1.0.0",
        readme: `# ${row.displayName}\n\nIsolated package SSR identity fixture.`,
        dummyOwner: { handle, displayName: handle, image: "" },
      })),
    }),
  ]);
  const identities = await run<Array<{ handle: string; id: string }>>([
    "--inline-query",
    `return await Promise.all(${JSON.stringify([ownerHandle, otherHandle])}.map(async handle => { const user = await ctx.db.query("users").withIndex("handle", q => q.eq("handle", handle)).unique(); return {handle, id: user._id}; }));`,
  ]);
  const identity = (id: string) =>
    JSON.stringify({
      subject: id,
      issuer: "https://local.invalid",
      tokenIdentifier: `local|${id}`,
    });
  const createToken = (id: string) =>
    run<{ token: string; tokenId: string }>([
      "tokens:create",
      JSON.stringify({ label: "Isolated SSR proof" }),
      "--identity",
      identity(id),
    ]);
  const owner = await createToken(identities[0]!.id);
  const unrelated = await createToken(identities[1]!.id);
  const headers = (token: string) => ({ Authorization: `Bearer ${token}` });
  const apiPath = `/api/v1/packages/${privateName}`;
  const detailPath = `/plugins/${privateName}`;
  const report: Array<{
    viewer: string;
    apiStatus: number;
    ssrStatus: number;
    privateVisible: boolean;
  }> = [];
  try {
    for (const viewer of [
      { label: "owner", token: owner.token, allowed: true },
      { label: "signed-out", token: undefined, allowed: false },
      { label: "unrelated", token: unrelated.token, allowed: false },
    ]) {
      const options = viewer.token ? { headers: headers(viewer.token) } : {};
      const apiResponse = await request.get(apiPath, options);
      expect(apiResponse.status()).toBe(viewer.allowed ? 200 : 404);
      const response = await request.get(detailPath, options);
      const html = await response.text();
      expect(response.status()).toBe(200);
      expect(html.includes(privateMarker)).toBe(viewer.allowed);
      expect(html).not.toContain(owner.token);
      expect(html).not.toContain(unrelated.token);
      report.push({
        viewer: viewer.label,
        apiStatus: apiResponse.status(),
        ssrStatus: response.status(),
        privateVisible: html.includes(privateMarker),
      });
    }
    const catalog = await request.get("/plugins", { headers: headers(owner.token) });
    const catalogHtml = await catalog.text();
    expect(catalog.status()).toBe(200);
    expect(catalogHtml).toContain('class="plugin-detail-link"');
    expect(catalogHtml).not.toContain(privateName);
    expect(catalogHtml).not.toContain(privateMarker);

    await run([
      "tokens:revoke",
      JSON.stringify({ tokenId: owner.tokenId }),
      "--identity",
      identity(identities[0]!.id),
    ]);
    const revokedApi = await request.get(apiPath, { headers: headers(owner.token) });
    // Optional read auth treats revoked tokens as signed out, concealing private
    // package existence rather than returning the required-auth 401 response.
    expect(revokedApi.status()).toBe(404);
    expect(await revokedApi.text()).toBe("Package not found");
    const revokedSsr = await request.get(detailPath, { headers: headers(owner.token) });
    const revokedHtml = await revokedSsr.text();
    expect(revokedSsr.status()).toBe(200);
    expect(revokedHtml).not.toContain(privateMarker);
    expect(revokedHtml).not.toContain(owner.token);
    report.push({
      viewer: "revoked-owner-token",
      apiStatus: revokedApi.status(),
      ssrStatus: revokedSsr.status(),
      privateVisible: revokedHtml.includes(privateMarker),
    });
    await testInfo.attach("compiled-ssr-authorization-boundary.json", {
      body: JSON.stringify({ publicCatalogOmitsPrivatePackage: true, report }, null, 2),
      contentType: "application/json",
    });
    console.log("Compiled SSR authorization boundary", JSON.stringify(report));
  } finally {
    await run([
      "tokens:revoke",
      JSON.stringify({ tokenId: owner.tokenId }),
      "--identity",
      identity(identities[0]!.id),
    ]);
    await run([
      "tokens:revoke",
      JSON.stringify({ tokenId: unrelated.tokenId }),
      "--identity",
      identity(identities[1]!.id),
    ]);
  }
});
