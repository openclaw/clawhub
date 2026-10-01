/* @vitest-environment node */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { fetchAgentSkillsDiscovery } from "../routes/$owner/skills/$slug/[.]well-known/agent-skills/index[.]json";

it("bounds real discovery headers and bodies while preserving completed responses", async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.url?.includes("/stall-headers/")) return;
    response.writeHead(request.url?.includes("/missing/") ? 404 : 200, {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
      "X-Upstream-Private": "synthetic-only",
    });
    if (request.url?.includes("/stall-body/")) {
      response.flushHeaders();
      response.write('{"skills":[');
      return;
    }
    response.end('{"skills":[]}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  vi.stubEnv("VITE_CONVEX_SITE_URL", `http://127.0.0.1:${port}`);
  vi.stubEnv("VITE_CLAWHUB_DEPLOY_ENV", "test");
  // Bound a regression without replacing the real fetch or its ten-second deadline.
  const watchdog = setTimeout(() => server.closeAllConnections(), 13_000);
  try {
    for (const method of ["GET", "HEAD"] as const) {
      for (const slug of ["healthy", "missing"]) {
        const response = await fetchAgentSkillsDiscovery("fixture", slug, method);
        expect(response.status).toBe(slug === "missing" ? 404 : 200);
        expect(response.headers.get("Content-Type")).toBe("application/json");
        expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
        expect(response.headers.get("X-Upstream-Private")).toBeNull();
        expect(await response.text()).toBe(method === "GET" ? '{"skills":[]}' : "");
      }
    }

    const outcomes = await Promise.allSettled([
      fetchAgentSkillsDiscovery("fixture", "stall-headers", "GET"),
      fetchAgentSkillsDiscovery("fixture", "stall-headers", "HEAD"),
      fetchAgentSkillsDiscovery("fixture", "stall-body", "GET"),
    ]);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") {
        expect(["TimeoutError", "AbortError"]).toContain(outcome.reason.name);
      }
    }
    expect(requests).toHaveLength(7);
  } finally {
    clearTimeout(watchdog);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    vi.unstubAllEnvs();
  }
}, 20_000);
