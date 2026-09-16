import { spawn } from "node:child_process";

export type LocalConvexBootstrapResult = { status: "ready" } | { status: "error"; message: string };

if (!process.send) throw new Error("Local Convex requires its runner's IPC channel.");
const send = process.send.bind(process);

// Keep the process-group leader alive after Convex's one-shot bootstrap exits.
process.on("message", () => {});
process.on("SIGTERM", () => {});
process.on("SIGINT", () => {});
process.on("disconnect", () => {
  process.kill(-process.pid, "SIGTERM");
  setTimeout(() => process.kill(-process.pid, "SIGKILL"), 5_000);
});

const bootstrap = spawn("bunx", process.argv.slice(2), { stdio: "inherit" });
function report(result: LocalConvexBootstrapResult) {
  if (process.connected) send(result);
}
bootstrap.once("error", (error) => report({ status: "error", message: error.message }));
bootstrap.once("exit", (code, signal) => {
  report(
    code === 0
      ? { status: "ready" }
      : {
          status: "error",
          message: `Local Convex bootstrap exited with ${signal ?? `code ${code}`}.`,
        },
  );
});
