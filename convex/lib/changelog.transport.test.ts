/* @vitest-environment node */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import {
  generateChangelogForPublish,
  generateChangelogPreview,
  generatePackageChangelogPreview,
} from "./changelog";

it("uses fallback notes after real provider header and body timeouts", async () => {
  const server = createServer((request, response) => {
    request.resume();
    if (request.url === "/stall-headers") return;
    response.writeHead(200, { "Content-Type": "application/json" });
    if (request.url === "/stall-body") {
      response.flushHeaders();
      response.write('{"output":[');
      return;
    }
    response.end(
      JSON.stringify({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "- Generated fixture notes." }],
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const realFetch = globalThis.fetch;
  vi.stubEnv("OPENAI_API_KEY", "synthetic-loopback-fixture");
  const provider = vi.fn((input: string, init: RequestInit) => {
    expect(input).toBe("https://api.openai.com/v1/responses");
    if (typeof init.body !== "string") throw new Error("Expected a JSON provider payload");
    const body = JSON.parse(init.body) as { input: string };
    const path = body.input.includes("stall-headers")
      ? "stall-headers"
      : body.input.includes("stall-body")
        ? "stall-body"
        : "healthy";
    return realFetch(`http://127.0.0.1:${port}/${path}`, init);
  });
  vi.stubGlobal("fetch", provider);
  const ctx = { runQuery: vi.fn(async () => null) } as unknown as ActionCtx;
  const flows = [
    (readmeText: string) =>
      generateChangelogForPublish(ctx, {
        slug: "fixture",
        version: "1.0.0",
        readmeText,
        files: [],
      }),
    (readmeText: string) =>
      generateChangelogPreview(ctx, {
        slug: "fixture",
        version: "1.0.0",
        readmeText,
        previous: null,
      }),
    (readmeText: string) =>
      generatePackageChangelogPreview(ctx, { name: "fixture", version: "1.0.0", readmeText }),
  ];
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let watchdogFired = false;
  try {
    for (const flow of flows) expect(await flow("healthy")).toBe("- Generated fixture notes.");
    watchdog = setTimeout(() => {
      watchdogFired = true;
      server.closeAllConnections();
    }, 13_000);
    const results = await Promise.all(
      flows.flatMap((flow) => [flow("stall-headers"), flow("stall-body")]),
    );
    expect(results).toEqual(Array(6).fill("- Initial release."));
    expect(watchdogFired).toBe(false);
    expect(provider).toHaveBeenCalledTimes(9);
  } finally {
    clearTimeout(watchdog);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
}, 20_000);
