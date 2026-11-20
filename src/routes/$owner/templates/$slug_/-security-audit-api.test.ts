/* @vitest-environment node */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPackageVersion } from "../../../../lib/packageApi";
import { loadTemplateSecurityAudit } from "./security-audit";

// Only replace the framework's request-context adapter. Package lookup, the
// version helper, error parsing and the audit loader all use real HTTP below.
vi.mock("nitro/app", () => ({
  serverFetch: (url: string, init: RequestInit) => fetch(url, init),
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHeaders: () => new Headers() }));

const name = "openclaw-music-manager";
const version = "1.1.0+audit/1";
const params = { owner: "ameliomansour", slug: name };
const releasePath = "/api/v1/packages/" + name + "/versions/" + encodeURIComponent(version);
let server: Server;
let releaseStatus: number | "disconnect";
let releaseBody: unknown;
let requests: string[];

beforeEach(async () => {
  releaseStatus = 200;
  releaseBody = {
    package: { name, displayName: "Music Manager", family: "template" },
    version: {
      version,
      createdAt: 1,
      files: [],
      artifact: { kind: "npm-pack", sha256: "a".repeat(64) },
    },
  };
  requests = [];
  server = createServer((req, res) => {
    requests.push(req.url ?? "");
    if (req.url === releasePath) {
      if (releaseStatus === "disconnect") {
        req.socket.destroy();
        return;
      }
      res.writeHead(releaseStatus, { "Content-Type": "application/json", "Retry-After": "17" });
      res.end(
        JSON.stringify(releaseStatus === 200 ? releaseBody : { error: "Registry unavailable" }),
      );
    } else if (req.url === "/api/v1/packages/" + name) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          package: {
            name,
            displayName: "Music Manager",
            family: "template",
            latestVersion: "2.0.0",
          },
          owner: { handle: params.owner },
        }),
      );
    } else {
      res.writeHead(404);
      res.end("Package not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  vi.stubEnv("VITE_CONVEX_SITE_URL", "http://127.0.0.1:" + (server.address() as AddressInfo).port);
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Template audit through the real package API HTTP boundary", () => {
  it("preserves a release 429 and its retry metadata instead of returning a false 404", async () => {
    releaseStatus = 429;
    await expect(fetchPackageVersion(name, version, { throwOnError: true })).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 17,
    });
    requests.length = 0;
    await expect(loadTemplateSecurityAudit(params, version)).resolves.toMatchObject({
      rateLimited: true,
      release: null,
    });
    expect(requests.filter((path) => path === releasePath)).toHaveLength(1);
  });

  it("propagates a release 500 to the route error boundary and recovers on a later retry", async () => {
    releaseStatus = 500;
    await expect(loadTemplateSecurityAudit(params, version)).rejects.toMatchObject({ status: 500 });
    expect(requests.filter((path) => path === releasePath)).toHaveLength(1);
    releaseStatus = 200;
    const result = await loadTemplateSecurityAudit(params, version);
    expect(result.release).toMatchObject({ version, artifact: { sha256: "a".repeat(64) } });
    expect(result.rateLimited).toBe(false);
    expect(requests.filter((path) => path === releasePath)).toHaveLength(2);
  });

  it("does not turn a disconnected release request into not-found", async () => {
    releaseStatus = "disconnect";
    // Hosted egress may represent a disconnected socket as an HTTP gateway
    // error; either transport must still reach the retry boundary, not 404.
    await expect(loadTemplateSecurityAudit(params, version)).rejects.toBeInstanceOf(Error);
    expect(requests.filter((path) => path === releasePath)).toHaveLength(1);
  });

  it("preserves the original fetch rejection through the real helper", async () => {
    const networkError = new TypeError("Connection lost");
    const actualFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
      new URL(input instanceof Request ? input.url : input).pathname === releasePath
        ? Promise.reject(networkError)
        : actualFetch(input, init),
    );
    await expect(loadTemplateSecurityAudit(params, version)).rejects.toBe(networkError);
    await expect(fetchPackageVersion(name, version)).resolves.toBeNull();
  });

  it("keeps a genuine HTTP 404 missing in strict mode and in the audit route", async () => {
    releaseStatus = 404;
    await expect(fetchPackageVersion(name, version, { throwOnError: true })).resolves.toBeNull();
    await expect(loadTemplateSecurityAudit(params, version)).rejects.toMatchObject({
      isNotFound: true,
    });
  });

  it.each([404, 429, 500, "disconnect"] as const)(
    "keeps legacy best-effort callers returning null for %s",
    async (status) => {
      releaseStatus = status;
      await expect(fetchPackageVersion(name, version)).resolves.toBeNull();
    },
  );

  it("reads the encoded exact historical release without substituting the latest artifact", async () => {
    const result = await loadTemplateSecurityAudit(params, version);
    expect(result.release).toMatchObject({ version, artifact: { sha256: "a".repeat(64) } });
    expect(requests).toEqual([
      "/api/v1/packages/%40ameliomansour%2F" + name,
      "/api/v1/packages/" + name,
      releasePath,
    ]);
  });

  it.each([
    { package: { name, family: "template" }, version: { version: "2.0.0" } },
    { package: { name: "another-template", family: "template" }, version: { version } },
    { package: { name, family: "code-plugin" }, version: { version } },
  ])(
    "rejects mismatched version, package and family from a successful release response",
    async (body) => {
      releaseBody = body;
      await expect(loadTemplateSecurityAudit(params, version)).rejects.toMatchObject({
        isNotFound: true,
      });
    },
  );
});
