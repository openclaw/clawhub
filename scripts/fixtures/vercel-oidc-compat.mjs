import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { assertFixtureHome, rejectExternalIo } from "./dependency-network-guard.mjs";

assertFixtureHome();

const [name, layout] = process.argv.slice(2);
const require =
  name === "baseline"
    ? createRequire(new URL("./dependency-baseline/package.json", import.meta.url))
    : createRequire(import.meta.url);
const oidcPath = require.resolve("@vercel/oidc");
const oidcRequire = createRequire(oidcPath);
const configPath = oidcRequire.resolve("@vercel/cli-config");
const configRequire = createRequire(configPath);
const xdgPath = configRequire.resolve("xdg-app-paths");
function packageVersion(entry) {
  let directory = dirname(entry);
  for (;;) {
    try {
      return JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).version;
    } catch {
      const parent = dirname(directory);
      assert.notEqual(parent, directory);
      directory = parent;
    }
  }
}
const versions = [packageVersion(oidcPath), packageVersion(configPath), packageVersion(xdgPath)];
assert.deepEqual(
  versions,
  name === "baseline" ? ["4.0.8", "0.3.8", "5.5.1"] : ["4.0.9", "0.4.0", "5.1.0"],
);

const dataHome = join(homedir(), "xdg-data");
if (layout !== "legacy") process.env.XDG_DATA_HOME = dataHome;
const expectedConfig =
  layout === "legacy" ? join(homedir(), ".now") : join(dataHome, "com.vercel.cli");
mkdirSync(expectedConfig, { recursive: true });
writeFileSync(join(expectedConfig, "auth.json"), JSON.stringify({ token: "fixture-vercel-token" }));
writeFileSync(join(expectedConfig, "config.json"), JSON.stringify({ credStorage: "file" }));
if (layout === "precedence") {
  mkdirSync(join(homedir(), ".now"));
  writeFileSync(join(homedir(), ".now/auth.json"), JSON.stringify({ token: "wrong-legacy-token" }));
}
const jwt = (tag) =>
  [
    "e30",
    Buffer.from(JSON.stringify({ exp: 4_102_444_800, tag })).toString("base64url"),
    "fixture",
  ].join(".");
const fresh = jwt("fresh");
let refreshes = 0;
const verifyIo = rejectExternalIo(async (url, init) => {
  assert.equal(
    String(url),
    "https://api.vercel.com/v1/projects/fixture-project/token?source=vercel-oidc-refresh&teamId=fixture-team",
  );
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer fixture-vercel-token");
  refreshes++;
  return new Response(JSON.stringify({ token: fresh }), { status: 200 });
});
const { getGlobalPathConfig } = oidcRequire("@vercel/cli-config");
assert.equal(getGlobalPathConfig(), expectedConfig);
const { getVercelOidcToken } = require("@vercel/oidc");
process.env.VERCEL_OIDC_TOKEN = fresh;
assert.equal(await getVercelOidcToken(), fresh);
const requestToken = jwt("request");
globalThis[Symbol.for("@vercel/request-context")] = {
  get: () => ({ headers: { "x-vercel-oidc-token": requestToken } }),
};
assert.equal(await getVercelOidcToken(), requestToken);
delete globalThis[Symbol.for("@vercel/request-context")];
const fileToken = jwt("file");
const tokenFile = join(homedir(), "fixture-oidc-token");
writeFileSync(tokenFile, fileToken);
process.env.VERCEL_OIDC_TOKEN_FILE = tokenFile;
assert.equal(await getVercelOidcToken(), fileToken);
delete process.env.VERCEL_OIDC_TOKEN_FILE;
delete process.env.VERCEL_OIDC_TOKEN;
assert.equal(await getVercelOidcToken({ project: "fixture-project", team: "fixture-team" }), fresh);
assert.equal(refreshes, 1);
delete process.env.VERCEL_OIDC_TOKEN;
assert.equal(await getVercelOidcToken({ project: "fixture-project", team: "fixture-team" }), fresh);
assert.equal(refreshes, 1);
verifyIo();
console.log(
  JSON.stringify({ versions, layout, fresh: true, request: true, file: true, refresh: true }),
);
