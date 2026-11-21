/* @vitest-environment node */

import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import type { LocalConvexBootstrapResult } from "./playwright-local-convex";

function probe(url: string): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const request = get(url, { agent: false }, (response) => {
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.once("end", () => resolveBody(body));
      response.once("error", reject);
    });
    request.setTimeout(500, () => request.destroy(new Error("Probe timed out.")));
    request.once("error", reject);
  });
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port.");
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}

function nextMessage(owner: ChildProcess) {
  return new Promise<LocalConvexBootstrapResult>((resolveMessage, reject) => {
    const timer = setTimeout(() => reject(new Error("No launcher result.")), 4_000);
    owner.once("message", (result: LocalConvexBootstrapResult) => {
      clearTimeout(timer);
      resolveMessage(result);
    });
  });
}

type FixtureOptions = {
  bootstrapExit?: number;
  leakedBootstrapBackend?: boolean;
  backendMode?: "early-exit" | "wrong-instance";
  backendMissing?: boolean;
  invalidConfig?: boolean;
};

async function fixture(
  options: FixtureOptions,
  check: (owner: ChildProcess, url: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "clawhub-backend-owner-"));
  let owner: ChildProcess | undefined;
  try {
    const cloud = await freePort();
    let site = await freePort();
    while (site === cloud) site = await freePort();
    const version = "precompiled-test";
    const stateDir = join(directory, ".convex/local/default");
    const binaryDir = join(directory, ".cache/convex/binaries", version);
    const binary = join(binaryDir, "convex-local-backend");
    await mkdir(stateDir, { recursive: true });
    await mkdir(binaryDir, { recursive: true });
    const config = {
      deploymentName: "anonymous-fixture",
      instanceSecret: "a".repeat(64),
      backendVersion: options.invalidConfig ? "../wrong" : version,
      ports: { cloud, site },
    };
    // Cover both Convex 1.50 cleanup and earlier CLIs that leaked a listener.
    await writeFile(
      join(directory, "bunx"),
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
writeFileSync(${JSON.stringify(join(stateDir, "config.json"))}, ${JSON.stringify(JSON.stringify(config))});
if (${Boolean(options.leakedBootstrapBackend)}) {
  const child = spawn('node', [${JSON.stringify(binary)}, '--port', '${cloud}', '--instance-name', 'anonymous-fixture', '--instance-secret', '${"a".repeat(64)}'], { stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.once('data', () => process.exit(${options.bootstrapExit ?? 0}));
} else process.exit(${options.bootstrapExit ?? 0});
`,
      { mode: 0o755 },
    );
    if (!options.backendMissing) {
      await writeFile(
        binary,
        `#!/usr/bin/env node
import { createServer } from 'node:http';
const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
if (${JSON.stringify(options.backendMode)} === 'early-exit') process.exit(9);
if (value('--instance-secret') !== 'a'.repeat(64)) process.exit(8);
if (args.includes('--local-storage') && value('--interface') !== '127.0.0.1') process.exit(6);
if (args.includes('--local-storage') && (!args.includes('--disable-beacon') || process.env.SENTRY_DSN !== '')) process.exit(5);
const name = ${JSON.stringify(options.backendMode)} === 'wrong-instance' ? 'wrong' : value('--instance-name');
const server = createServer((request, response) => {
  response.end(name);
  if (request.url === '/stop') server.close(() => process.exit(0));
});
setTimeout(() => server.listen(Number(value('--port')), value('--interface') ?? '127.0.0.1', () => process.stdout.write('ready')), 100);
`,
        { mode: 0o755 },
      );
    }
    owner = spawn(
      "bun",
      [resolve("scripts/playwright-local-convex.ts"), "convex", "dev", "--skip-push"],
      {
        cwd: directory,
        detached: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: {
          ...process.env,
          HOME: directory,
          PATH: `${directory}:${process.env.PATH}`,
          VITE_CONVEX_URL: `http://127.0.0.1:${cloud}`,
          VITE_CONVEX_SITE_URL: `http://127.0.0.1:${site}`,
          PLAYWRIGHT_LOCAL_AUTH_BACKEND_VERSION: version,
          PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS: "2000",
        },
      },
    );
    let diagnostics = "";
    owner.stdout?.on("data", (data) => {
      diagnostics += String(data);
    });
    owner.stderr?.on("data", (data) => {
      diagnostics += String(data);
    });
    try {
      await check(owner, `http://127.0.0.1:${cloud}`);
    } catch (error) {
      throw new Error(diagnostics, { cause: error });
    }
  } finally {
    if (owner?.pid && owner.exitCode === null && owner.signalCode === null) {
      // Let the owner terminate its detached bootstrap group before forcing it down.
      if (owner.connected) owner.disconnect();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          once(owner, "exit"),
          new Promise<void>((resolveTimeout) => {
            timer = setTimeout(resolveTimeout, 5_500);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (owner.exitCode === null && owner.signalCode === null) {
        const exited = once(owner, "exit");
        process.kill(-owner.pid, "SIGKILL");
        await exited;
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
}

it.skipIf(process.platform === "win32").each([false, true])(
  "owns its backend after bootstrap exits (leaked: %j)",
  async (leakedBootstrapBackend) => {
    await fixture({ leakedBootstrapBackend }, async (owner, url) => {
      expect(await nextMessage(owner)).toEqual({ status: "ready" });
      expect(await probe(`${url}/instance_name`)).toBe("anonymous-fixture");
      expect(owner.exitCode).toBeNull();
      process.kill(-owner.pid!, "SIGTERM");
      await expect
        .poll(() =>
          probe(url).then(
            () => true,
            () => false,
          ),
        )
        .toBe(false);
      // Keep the leader alive so the runner can kill any remaining descendants.
      expect(owner.exitCode).toBeNull();
    });
  },
);

it
  .skipIf(process.platform === "win32")
  .each([
    { bootstrapExit: 7 },
    { bootstrapExit: 7, leakedBootstrapBackend: true },
    { backendMode: "early-exit" as const },
    { backendMode: "wrong-instance" as const },
    { backendMissing: true },
    { invalidConfig: true },
  ])("does not report a failed backend as ready: %j", async (options) => {
  await fixture(options, async (owner) => {
    expect((await nextMessage(owner)).status).toBe("error");
  });
});

it.skipIf(process.platform === "win32")(
  "reports an unexpected backend exit after readiness",
  async () => {
    await fixture({}, async (owner, url) => {
      expect((await nextMessage(owner)).status).toBe("ready");
      const failure = nextMessage(owner);
      await probe(`${url}/stop`);
      expect(await failure).toEqual({
        status: "error",
        message: "Local Convex backend exited with code 0.",
      });
    });
  },
);

it.skipIf(process.platform === "win32")(
  "cleans up its backend when the runner disconnects",
  async () => {
    await fixture({}, async (owner, url) => {
      expect((await nextMessage(owner)).status).toBe("ready");
      const exited = once(owner, "exit");
      owner.disconnect();
      await exited;
      await expect
        .poll(() =>
          probe(url).then(
            () => true,
            () => false,
          ),
        )
        .toBe(false);
    });
  },
  10_000,
);
