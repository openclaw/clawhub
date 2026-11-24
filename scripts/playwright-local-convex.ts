import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export type LocalConvexBootstrapResult = { status: "ready" } | { status: "error"; message: string };

const READY_LINE = "clawhub-local-convex:ready";

if (process.argv[2] === "--ready-hook") {
  // Convex runs --start only after its first successful push. With --once it
  // waits for this child, retaining its backend without a development watcher.
  // The CLI detaches this child but inherits stdin. Its pipe ties it to our owner even
  // when that owner's process group is killed without running cleanup handlers.
  process.stdin.once("end", () => process.exit(0));
  process.stdin.once("error", () => process.exit(1));
  process.stdin.resume();
  process.stdout.write(`${READY_LINE}\n`);
} else {
  if (!process.send) throw new Error("Local Convex requires its runner's IPC channel.");
  const send = process.send.bind(process);
  const serve = process.argv[2] === "--serve";
  const args = process.argv.slice(serve ? 3 : 2);
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  if (serve) {
    args.push(
      "--once",
      "--start",
      `${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))} --ready-hook`,
    );
  }

  // Retain the group leader until the runner has stopped all owned descendants.
  process.on("message", () => {});
  const stopKeeper = () => bootstrap.stdin?.end();
  process.on("SIGTERM", stopKeeper);
  process.on("SIGINT", stopKeeper);
  process.on("disconnect", () => {
    stopKeeper();
    process.kill(-process.pid, "SIGTERM");
    setTimeout(() => process.kill(-process.pid, "SIGKILL"), 5_000);
  });

  const bootstrap = spawn("bunx", args, {
    stdio: serve ? ["pipe", "pipe", "inherit"] : "inherit",
  });
  let reported = false;
  function report(result: LocalConvexBootstrapResult) {
    if (reported) return;
    reported = true;
    if (process.connected) send(result);
  }
  if (serve && bootstrap.stdout) {
    bootstrap.stdout.pipe(process.stdout);
    createInterface({ input: bootstrap.stdout }).on("line", (line) => {
      if (line === READY_LINE) report({ status: "ready" });
    });
  }
  bootstrap.once("error", (error) => report({ status: "error", message: error.message }));
  bootstrap.once("exit", (code, signal) => {
    report(
      !serve && code === 0
        ? { status: "ready" }
        : {
            status: "error",
            message: `Local Convex ${serve ? "server" : "bootstrap"} exited with ${signal ?? `code ${code}`} before readiness.`,
          },
    );
  });
}
