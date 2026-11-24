/* @vitest-environment node */

import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import type { LocalConvexBootstrapResult } from "./playwright-local-convex";

// The fixture kills its listener between probes, so each request owns its socket.
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
    request.once("error", reject);
  });
}

it.skipIf(process.platform === "win32").each([
  { bootstrapExit: 0, disconnect: false, serve: false, exitBeforeReady: false },
  { bootstrapExit: 7, disconnect: false, serve: false, exitBeforeReady: false },
  { bootstrapExit: 0, disconnect: true, serve: false, exitBeforeReady: false },
  { bootstrapExit: 0, disconnect: false, serve: true, exitBeforeReady: false },
  { bootstrapExit: 0, disconnect: true, serve: true, exitBeforeReady: false },
  { bootstrapExit: 0, disconnect: false, serve: true, exitBeforeReady: true },
  { bootstrapExit: 7, disconnect: false, serve: true, exitBeforeReady: true },
  { bootstrapExit: 0, disconnect: false, serve: true, exitBeforeReady: false, abrupt: true },
])("owns Convex readiness and cleanup: %j", async (options) => {
  const { bootstrapExit, disconnect, serve, exitBeforeReady } = options;
  const directory = await mkdtemp(join(tmpdir(), "clawhub-backend-owner-"));
  const serverPath = join(directory, "server.mjs");
  const addressPath = join(directory, "address.json");
  const keeperPath = join(directory, "keeper.json");
  let owner: ChildProcess | undefined;
  let serverUrl: string | undefined;
  let keeperPid: number | undefined;
  try {
    await writeFile(
      serverPath,
      `import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
const server = createServer((request, response) => {
  response.end('alive');
  if (request.url === '/stop') server.close(() => process.exit(0));
});
server.listen(0, '127.0.0.1', () => {
  writeFileSync(${JSON.stringify(addressPath)}, JSON.stringify({ port: server.address().port }));
  process.stdout.write('ready');
});
`,
    );
    await writeFile(
      join(directory, "bunx"),
      `#!/usr/bin/env bun
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const backend = spawn(process.execPath, [${JSON.stringify(serverPath)}], {
  stdio: ['ignore', 'pipe', 'ignore'],
});
backend.stdout.once('data', () => {
  if (!${serve}) process.exit(Number(process.argv[2]));
  if (${exitBeforeReady}) {
    backend.once('exit', () => process.exit(Number(process.argv[2])));
    backend.kill('SIGTERM');
    return;
  }
  const start = process.argv.indexOf('--start');
  if (!process.argv.includes('--once') || start < 0) process.exit(9);
  const keeper = spawn(process.argv[start + 1], { shell: true, stdio: 'inherit', detached: true });
  writeFileSync(${JSON.stringify(keeperPath)}, JSON.stringify(keeper.pid));
  keeper.once('exit', (code) => {
    backend.kill('SIGTERM');
    process.exit(code ?? 1);
  });
});
`,
      { mode: 0o755 },
    );

    owner = spawn(
      "bun",
      [
        resolve("scripts/playwright-local-convex.ts"),
        ...(serve ? ["--serve"] : []),
        String(bootstrapExit),
      ],
      {
        detached: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
      },
    );
    const bootstrapOwner = owner;
    const result = await new Promise<LocalConvexBootstrapResult>((resolveResult, reject) => {
      bootstrapOwner.once("error", reject);
      bootstrapOwner.once("exit", () =>
        reject(new Error("Owner exited before reporting bootstrap")),
      );
      bootstrapOwner.once("message", resolveResult);
    });
    const ready = bootstrapExit === 0 && !exitBeforeReady;
    expect(result.status).toBe(ready ? "ready" : "error");
    const { port } = z
      .object({ port: z.number() })
      .parse(JSON.parse(await readFile(addressPath, "utf8")));
    const url = `http://127.0.0.1:${port}`;
    serverUrl = url;
    if (serve && exitBeforeReady) {
      await expect
        .poll(() =>
          probe(url).then(
            () => true,
            () => false,
          ),
        )
        .toBe(false);
    } else {
      expect(await probe(url)).toBe("alive");
    }
    expect(owner.exitCode).toBeNull();
    if (serve && !exitBeforeReady) {
      keeperPid = z.number().parse(JSON.parse(await readFile(keeperPath, "utf8")));
    }

    if ("abrupt" in options && options.abrupt) {
      const exited = once(owner, "exit");
      process.kill(-owner.pid!, "SIGKILL");
      await exited;
    } else if (disconnect) {
      const exited = once(owner, "exit");
      owner.disconnect();
      await exited;
    } else {
      if (!owner.pid) throw new Error("Owner did not start");
      process.kill(-owner.pid, "SIGTERM");
      await expect
        .poll(() =>
          probe(url).then(
            () => true,
            () => false,
          ),
        )
        .toBe(false);
      expect(owner.exitCode).toBeNull();
      expect(owner.signalCode).toBeNull();
      const exited = once(owner, "exit");
      process.kill(-owner.pid, "SIGKILL");
      await exited;
    }
    await expect
      .poll(() =>
        probe(url).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false);
    if (keeperPid) {
      await expect
        .poll(() => {
          try {
            process.kill(-keeperPid!, 0);
            return true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
            return false;
          }
        })
        .toBe(false);
    }
  } finally {
    if (serverUrl) await probe(`${serverUrl}/stop`).catch(() => {});
    if (owner?.pid && owner.exitCode === null && owner.signalCode === null) {
      const exited = once(owner, "exit");
      process.kill(-owner.pid, "SIGKILL");
      await exited;
    }
    if (keeperPid) {
      try {
        process.kill(-keeperPid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
});
