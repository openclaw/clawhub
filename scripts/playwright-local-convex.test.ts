/* @vitest-environment node */

import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import type { LocalConvexBootstrapResult } from "./playwright-local-convex";

it.skipIf(process.platform === "win32").each([
  { bootstrapExit: 0, disconnect: false },
  { bootstrapExit: 7, disconnect: false },
  { bootstrapExit: 0, disconnect: true },
])("owns bootstrap descendants through cleanup: %j", async ({ bootstrapExit, disconnect }) => {
  const directory = await mkdtemp(join(tmpdir(), "clawhub-backend-owner-"));
  const serverPath = join(directory, "server.mjs");
  const addressPath = join(directory, "address.json");
  let owner: ChildProcess | undefined;
  let serverUrl: string | undefined;
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
const backend = spawn(process.execPath, [${JSON.stringify(serverPath)}], {
  stdio: ['ignore', 'pipe', 'ignore'],
});
backend.stdout.once('data', () => process.exit(Number(process.argv[2])));
`,
      { mode: 0o755 },
    );

    owner = spawn("bun", [resolve("scripts/playwright-local-convex.ts"), String(bootstrapExit)], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });
    const bootstrapOwner = owner;
    const result = await new Promise<LocalConvexBootstrapResult>((resolveResult, reject) => {
      bootstrapOwner.once("error", reject);
      bootstrapOwner.once("exit", () =>
        reject(new Error("Owner exited before reporting bootstrap")),
      );
      bootstrapOwner.once("message", resolveResult);
    });
    expect(result.status).toBe(bootstrapExit === 0 ? "ready" : "error");
    const { port } = z
      .object({ port: z.number() })
      .parse(JSON.parse(await readFile(addressPath, "utf8")));
    const url = `http://127.0.0.1:${port}`;
    serverUrl = url;
    expect(await (await fetch(url)).text()).toBe("alive");
    expect(owner.exitCode).toBeNull();

    if (disconnect) {
      const exited = once(owner, "exit");
      owner.disconnect();
      await exited;
    } else {
      if (!owner.pid) throw new Error("Owner did not start");
      process.kill(-owner.pid, "SIGTERM");
      await expect
        .poll(() =>
          fetch(url).then(
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
        fetch(url).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false);
  } finally {
    if (serverUrl) await fetch(`${serverUrl}/stop`).catch(() => {});
    if (owner?.pid && owner.exitCode === null && owner.signalCode === null) {
      const exited = once(owner, "exit");
      process.kill(-owner.pid, "SIGKILL");
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
