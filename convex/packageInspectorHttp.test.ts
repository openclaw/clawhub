/* @vitest-environment node */

import { unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  absolutePackageArtifactUrl,
  packageInspectorAcknowledgeHttp,
  packageInspectorArtifactHttp,
  packageInspectorClaimHttp,
  packageInspectorNotifyHttp,
  packageInspectorResultsHttp,
} from "./packageInspectorHttp";

type HttpHandler = {
  _handler: (ctx: unknown, request: Request) => Promise<Response>;
};

const packageInspectorResultsHttpHandler = (packageInspectorResultsHttp as unknown as HttpHandler)
  ._handler;
const packageInspectorClaimHttpHandler = (packageInspectorClaimHttp as unknown as HttpHandler)
  ._handler;
const packageInspectorNotifyHttpHandler = (packageInspectorNotifyHttp as unknown as HttpHandler)
  ._handler;
const packageInspectorAcknowledgeHttpHandler = (
  packageInspectorAcknowledgeHttp as unknown as HttpHandler
)._handler;
const packageInspectorArtifactHttpHandler = (packageInspectorArtifactHttp as unknown as HttpHandler)
  ._handler;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("package inspector HTTP helpers", () => {
  it("returns the protected artifact route for scan claims", () => {
    const request = new Request("https://example.com/api/v1/package-inspector/claim");

    expect(absolutePackageArtifactUrl(request, "packageReleases:demo-1")).toBe(
      "https://example.com/api/v1/package-inspector/artifact?releaseId=packageReleases%3Ademo-1",
    );
  });

  it("projects historical legacy filenames for the protected Linux scan worker", async () => {
    vi.stubEnv("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN", "worker-token");
    const response = await packageInspectorArtifactHttpHandler(
      {
        runQuery: vi.fn().mockResolvedValue({
          packageName: "s2-space-agent-os",
          version: "2.0.0",
          artifactKind: "legacy-zip",
          files: [
            { path: "s2-os-core:requirements.txt", storageId: "storage:requirements" },
            {
              path: "docs/blueprints/Standard\u00e2\u0080\u0094_Unit_Habitat_Swarm.md",
              storageId: "storage:blueprint",
            },
          ],
        }),
        storage: {
          get: vi.fn(async (storageId: string) => new Blob([storageId])),
        },
      },
      new Request(
        "https://example.com/api/v1/package-inspector/artifact?releaseId=packageReleases:s2",
        { headers: { Authorization: "Bearer worker-token" } },
      ),
    );

    expect(response.status).toBe(200);
    const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual([
      "package/docs/blueprints/Standard\u00e2\u0080\u0094_Unit_Habitat_Swarm.md",
      "package/s2-os-core:requirements.txt",
    ]);
  });

  it("keeps owner notifications off when nightly results omit the opt-in", async () => {
    vi.stubEnv("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN", "worker-token");
    const runAction = vi.fn();
    const response = await packageInspectorResultsHttpHandler(
      {
        runMutation: vi.fn().mockResolvedValue({
          ok: true,
          inserted: 1,
          shouldEmailOwner: true,
        }),
        runAction,
      },
      new Request("https://example.com/api/v1/package-inspector/results", {
        method: "POST",
        headers: {
          Authorization: "Bearer worker-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          packageId: "packages:demo",
          releaseId: "packageReleases:demo-1",
          inspectorVersion: "0.5.0",
          targetOpenClawVersion: "2026.8.0-beta.1",
          findings: [{ code: "missing-api", message: "API removed" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(runAction).not.toHaveBeenCalled();
  });

  it("passes the exact beta target and inspector version into batch selection", async () => {
    vi.stubEnv("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN", "worker-token");
    const runQuery = vi.fn().mockResolvedValue({
      ok: true,
      leased: false,
      nextCursor: null,
      skippedUnchanged: 1,
      items: [],
    });
    const response = await packageInspectorClaimHttpHandler(
      { runQuery },
      new Request(
        "https://example.com/api/v1/package-inspector/claim?dryRun=true&inspectorVersion=0.6.0&targetOpenClawVersion=2026.8.0-beta.1&notifyOwners=true",
        { headers: { Authorization: "Bearer worker-token" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(runQuery.mock.calls[0]?.[1]).toEqual({
      batchSize: 25,
      cursor: null,
      inspectorVersion: "0.6.0",
      targetOpenClawVersion: "2026.8.0-beta.1",
      notifyOwners: true,
    });
  });

  it("completes warning-only notification rows without sending email", async () => {
    vi.stubEnv("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN", "worker-token");
    const runMutation = vi.fn().mockResolvedValue({ ok: true, marked: true });
    const runAction = vi.fn().mockResolvedValue({
      ok: true,
      sent: false,
      reason: "no-context",
    });
    const response = await packageInspectorNotifyHttpHandler(
      { runAction, runMutation },
      new Request("https://example.com/api/v1/package-inspector/notify", {
        method: "POST",
        headers: {
          Authorization: "Bearer worker-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          packageId: "packages:demo",
          releaseId: "packageReleases:demo-1",
          inspectorVersion: "0.6.0",
          targetOpenClawVersion: "2026.8.0-beta.1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(runAction).toHaveBeenCalledOnce();
    expect(runMutation).toHaveBeenCalledOnce();
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      packageId: "packages:demo",
      releaseId: "packageReleases:demo-1",
      inspectorVersion: "0.6.0",
      targetOpenClawVersion: "2026.8.0-beta.1",
    });
  });

  it("continues a persisted scan run from the caller cursor", async () => {
    vi.stubEnv("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN", "worker-token");
    const runMutation = vi.fn().mockResolvedValue({
      ok: true,
      leased: false,
      nextCursor: null,
      skippedUnchanged: 0,
      items: [],
    });
    const response = await packageInspectorClaimHttpHandler(
      { runMutation },
      new Request(
        "https://example.com/api/v1/package-inspector/claim?runId=run-42&cursor=page-2&inspectorVersion=0.6.0&targetOpenClawVersion=2026.8.0-beta.1",
        { headers: { Authorization: "Bearer worker-token" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      batchSize: 25,
      cursor: "page-2",
      runId: "run-42",
      inspectorVersion: "0.6.0",
      targetOpenClawVersion: "2026.8.0-beta.1",
    });
  });

  it("acknowledges a processed batch cursor for the owning scan run", async () => {
    vi.stubEnv("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN", "worker-token");
    const runMutation = vi.fn().mockResolvedValue({
      ok: true,
      cursor: "page-2",
      completed: false,
    });
    const response = await packageInspectorAcknowledgeHttpHandler(
      { runMutation },
      new Request(
        "https://example.com/api/v1/package-inspector/acknowledge?runId=run-42&cursor=page-2",
        {
          method: "POST",
          headers: { Authorization: "Bearer worker-token" },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      runId: "run-42",
      cursor: "page-2",
    });
  });

  it("acknowledges the final processed batch with a null cursor", async () => {
    vi.stubEnv("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN", "worker-token");
    const runMutation = vi.fn().mockResolvedValue({ ok: true, cursor: null, completed: true });
    const response = await packageInspectorAcknowledgeHttpHandler(
      { runMutation },
      new Request("https://example.com/api/v1/package-inspector/acknowledge?runId=run-42", {
        method: "POST",
        headers: { Authorization: "Bearer worker-token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({ runId: "run-42", cursor: null });
  });
});
