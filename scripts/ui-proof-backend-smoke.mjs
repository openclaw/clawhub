#!/usr/bin/env node
// Opt-in only. Run through the session's approved server/preview launcher.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPortsFree, CONVEX_CLI_VERSION, runProofBackend } from "./ui-proof-backend.mjs";

const args = process.argv.slice(2);
if (
  args[0] !== "--run" ||
  args[1] !== "--cli" ||
  !args[2] ||
  args[3] !== "--backend-archive" ||
  !args[4] ||
  args.length !== 5
) {
  console.error(
    "Usage (starts real loopback servers): node scripts/ui-proof-backend-smoke.mjs --run --cli /verified/convex/bin/main.js --backend-archive /verified/convex-local-backend-<target>.zip",
  );
  process.exitCode = 2;
} else {
  await smoke(path.resolve(args[2]), path.resolve(args[4]));
}

async function smoke(cliPath, backendArchive) {
  const require = createRequire(cliPath);
  const { ConvexHttpClient } = require("convex/browser");
  const { anyApi } = require("convex/server");
  const root = await fs.mkdtemp("/tmp/clawhub-proof-smoke-");
  const wrapperRoot = path.join(root, "wrapper");
  const packageRoot = path.resolve(path.dirname(cliPath), "..");
  const modules = fileURLToPath(new URL("../node_modules", import.meta.url));
  const identities = new Set();
  try {
    await fs.mkdir(wrapperRoot);
    // Dependencies only, never copied dotenv/auth/Convex state. The helper itself
    // is imported from this trusted script, not from either tiny app fixture.
    await fs.symlink(modules, path.join(wrapperRoot, "node_modules"));
    assert.equal(
      execFileSync(process.execPath, [cliPath, "--version"], {
        cwd: wrapperRoot,
        env: {
          PATH: process.env.PATH,
          HOME: root,
          XDG_CONFIG_HOME: path.join(root, "config"),
          XDG_CACHE_HOME: path.join(root, "cache"),
          NODE_PATH: modules,
          CI: "1",
        },
        encoding: "utf8",
        timeout: 30000,
      }).trim(),
      CONVEX_CLI_VERSION,
    );
    for (const [name, devAuth] of [
      ["baseline", false],
      ["candidate", true],
      ["candidate", false],
    ]) {
      const appRoot = path.join(root, `${name}-${devAuth}`);
      await fs.mkdir(path.join(appRoot, "convex"), { recursive: true });
      await fs.mkdir(path.join(appRoot, "node_modules"));
      await fs.symlink(packageRoot, path.join(appRoot, "node_modules/convex"));
      await fs.writeFile(
        path.join(appRoot, "package.json"),
        JSON.stringify({ type: "module", dependencies: { convex: "1.44.0" } }),
      );
      await fs.writeFile(
        path.join(appRoot, "convex/schema.ts"),
        `import {defineSchema, defineTable} from "convex/server"; import {v} from "convex/values"; export default defineSchema({markers: defineTable({value:v.string()})});\n`,
      );
      await fs.writeFile(
        path.join(appRoot, "convex/appMeta.ts"),
        `
import {queryGeneric as query, mutationGeneric as mutation} from "convex/server";
export const getDeploymentInfo = query({args:{},handler:async(ctx)=>({
  source:${JSON.stringify(name)}, count:(await ctx.db.query("markers").take(2)).length,
  enabled:process.env.DEV_AUTH_ENABLED ?? null,
  marker:process.env.DEV_AUTH_CONVEX_DEPLOYMENT ?? null,
  site:process.env.CONVEX_SITE_URL ?? null
})});
export const insert = mutation({args:{},handler:async(ctx)=>{await ctx.db.insert("markers",{value:"smoke"});return null;}});
`,
      );
      const lane = {
        name,
        convexCloudPort: name === "baseline" ? 4417 : 4418,
        convexSitePort: name === "baseline" ? 4517 : 4518,
        port: name === "baseline" ? 4317 : 4318,
      };
      const outputDir = path.join(root, "artifacts", `${name}-${devAuth}`);
      let privateState;
      const result = await runProofBackend({
        appRoot,
        wrapperRoot,
        outputDir,
        lane,
        devAuth,
        cliPath,
        backendArchive,
        continueWith: async ({ env, instanceName, signal }) => {
          privateState = path.dirname(env.HOME);
          const client = new ConvexHttpClient(env.VITE_CONVEX_URL, {
            fetch: (url, init) => fetch(url, { ...init, signal }),
          });
          const read = () => client.query(anyApi.appMeta.getDeploymentInfo, {});
          const value = await read();
          assert.equal(value.source, name);
          assert.equal(value.count, 0);
          assert.equal(value.enabled, devAuth ? "1" : null);
          assert.equal(value.marker, devAuth ? `local:${instanceName}` : null);
          assert.equal(value.site, env.VITE_CONVEX_SITE_URL);
          assert.equal(
            await (await fetch(`${env.VITE_CONVEX_URL}/instance_name`, { signal })).text(),
            instanceName,
          );
          await client.mutation(anyApi.appMeta.insert, {});
          assert.equal((await read()).count, 1);
          await fetch(env.VITE_CONVEX_SITE_URL, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
          });
          if (process.platform === "darwin") {
            const sockets = execFileSync(
              "/usr/sbin/lsof",
              [
                "-nP",
                `-iTCP:${lane.convexCloudPort}`,
                `-iTCP:${lane.convexSitePort}`,
                "-sTCP:LISTEN",
                "-Fn",
              ],
              { encoding: "utf8" },
            )
              .split("\n")
              .filter((line) => line.startsWith("n"));
            assert.deepEqual(
              new Set(sockets),
              new Set([`n127.0.0.1:${lane.convexCloudPort}`, `n127.0.0.1:${lane.convexSitePort}`]),
            );
          }
        },
      });
      const completion = JSON.parse(
        await fs.readFile(path.join(outputDir, "bootstrap-summary.json"), "utf8"),
      );
      assert.equal(completion.status, "pass");
      assert.equal(completion.instanceName, result.instanceName);
      assert(!identities.has(result.instanceName));
      identities.add(result.instanceName);
      await assertPortsFree([lane.convexCloudPort, lane.convexSitePort, lane.port]);
      await assert.rejects(fs.stat(privateState), { code: "ENOENT" });
      console.log(
        `${name} devAuth=${devAuth}: source, fresh database, app query, site listener, teardown passed (${result.backendVersion}, CLI ${result.cliVersion})`,
      );
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
