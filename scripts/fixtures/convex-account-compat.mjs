import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { assertFixtureHome, rejectExternalIo } from "./dependency-network-guard.mjs";

assertFixtureHome();

const verifyIo = rejectExternalIo();
function helpers(baseline) {
  const require = createRequire(
    baseline ? new URL("./dependency-baseline/package.json", import.meta.url) : import.meta.url,
  );
  const root = dirname(require.resolve("convex/package.json"));
  assert.equal(
    JSON.parse(readFileSync(join(root, "package.json"))).version,
    baseline ? "1.49.0" : "1.50.0",
  );
  const filename = join(root, "dist/cli.bundle.cjs");
  const code = readFileSync(filename, "utf8");
  const expectedHash = baseline
    ? "de7c7ded59ba4258c76cc308fc28e429f23fd3a31df419364183fe444d824621"
    : "b27df8835a27baafc85611e1d11a655fb79f6ad860674a71a7679cb8a6035d43";
  assert.equal(
    createHash("sha256").update(code).digest("hex"),
    expectedHash,
    "Published CLI bundle changed; inspect the new entrypoint before qualifying it.",
  );
  const entry = "\nvoid main();";
  assert.equal(code.split(entry).length, 2, "Pinned CLI entrypoint changed.");
  const exports = baseline
    ? "readGlobalConfig, nodeFs"
    : "readGlobalConfig, nodeFs, readAccountSettings, getAccountSelection, legacyAuthForFirstAccount, writeAccountCredentials, initializeDefaultAccount, writeAccountDirectory, readAccountAuth, loadAccountCredentials";
  // Expose the published helper bodies without invoking the CLI, login or telemetry.
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(root);
  loaded._compile(code.replace(entry, `\nmodule.exports = { ${exports} };`), filename);
  return loaded.exports;
}
const previous = helpers(true);
const current = helpers(false);
const cleanups = new Map();
const ctx = {
  fs: current.nodeFs,
  crash: async ({ printedMessage }) => {
    throw new Error(printedMessage);
  },
  registerCleanup: (fn) => {
    const id = String(cleanups.size);
    cleanups.set(id, fn);
    return id;
  },
  removeCleanup: (id) => cleanups.delete(id),
};
const configPath = join(homedir(), ".convex/config.json");
mkdirSync(dirname(configPath), { recursive: true });
const legacy = { accessToken: "fixture-legacy-token", preservedSetting: "keep" };
writeFileSync(configPath, JSON.stringify(legacy));
chmodSync(configPath, 0o644);
assert.deepEqual(previous.readGlobalConfig(ctx), { accessToken: legacy.accessToken });
assert.deepEqual(current.readGlobalConfig(ctx), { accessToken: legacy.accessToken });
if (process.platform !== "win32") assert.equal(statSync(configPath).mode & 0o777, 0o600);
assert.deepEqual(await current.readAccountSettings(ctx), legacy);
assert.equal(await current.getAccountSelection(ctx), null);
assert.equal(
  (await current.legacyAuthForFirstAccount(ctx, { name: "work", source: "fixture" })).accessToken,
  legacy.accessToken,
);
await current.writeAccountCredentials(ctx, "work", legacy.accessToken);
await current.initializeDefaultAccount(ctx, { name: "work", source: "fixture" }, true);
assert.equal((await current.getAccountSelection(ctx)).name, "work");
await current.writeAccountCredentials(ctx, "personal", "fixture-personal-token");
await current.writeAccountDirectory(ctx, "personal");
assert.equal((await current.getAccountSelection(ctx)).name, "personal");
mkdirSync("child");
const parent = process.cwd();
process.chdir("child");
assert.equal((await current.getAccountSelection(ctx)).name, "personal");
process.chdir(parent);
assert.equal(previous.readGlobalConfig(ctx).accessToken, legacy.accessToken);
assert.equal(JSON.parse(readFileSync(configPath, "utf8")).preservedSetting, "keep");
process.env.CONVEX_ACCOUNT = "work";
assert.equal((await current.getAccountSelection(ctx)).name, "work");
assert.equal((await current.getAccountSelection(ctx, { name: "personal" })).name, "personal");
delete process.env.CONVEX_ACCOUNT;
writeFileSync(".env.local", "CONVEX_ACCOUNT=work\n");
assert.equal((await current.getAccountSelection(ctx)).name, "work");
writeFileSync("custom.env", "CONVEX_ACCOUNT=personal\n");
assert.equal((await current.getAccountSelection(ctx, { envFile: "custom.env" })).name, "personal");
writeFileSync(".env.local", "CONVEX_ACCOUNT=\n");
assert.equal((await current.getAccountSelection(ctx)).name, "personal");
assert.equal(
  (await current.readAccountAuth(ctx, { name: "work", source: "fixture" })).accessToken,
  legacy.accessToken,
);
if (process.platform !== "win32") {
  const directory = join(homedir(), ".convex/accounts");
  chmodSync(directory, 0o755);
  chmodSync(join(directory, "work.json"), 0o644);
  current.loadAccountCredentials(ctx, "work");
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(directory, "work.json")).mode & 0o777, 0o600);
}
assert.equal(cleanups.size, 0);
verifyIo();
console.log(
  JSON.stringify({ legacyReadable: true, selection: true, preserved: true, permissions: true }),
);
