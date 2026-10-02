import type { Route } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { PreviewProofFailure, routePreviewRequest } from "./lib/previewAnalyticsProof";
import { runPreviewProof, runAndWritePreviewProof } from "./verify-preview-proof";

const sha = "a".repeat(40);
const origin = "https://clawhub-git-feat-native-ga4-openclaw-foundation.vercel.app";
const env = {
  PREVIEW_URL: origin,
  EXPECTED_SHA: sha,
  VERCEL_AUTOMATION_BYPASS_SECRET: "fixture-read-credential",
  CLAWHUB_E2E_SKILL_SLUG: "02-team-operation",
  CLAWHUB_E2E_SKILL_OWNER: "",
};
const detail = {
  skill: { slug: "02-team-operation", displayName: "Seeded preview skill", summary: null },
  owner: { handle: "preview-seeded-owner" },
  latestVersion: { version: "1.0.0" },
};

describe("exact-head preview proof orchestration", () => {
  it("first requires the actual seeded detail, then file/home assertions and analytics proof", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(detail))
      .mockResolvedValueOnce(new Response("# Seeded skill"))
      .mockResolvedValueOnce(new Response("<title>ClawHub</title>"));
    const analyticsProof = vi.fn().mockResolvedValue({ google_requests: 0 });
    const receipt = await runPreviewProof({ env, fetchImpl, analyticsProof, readHead: () => sha });
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual([
      `${origin}/api/v1/skills/02-team-operation`,
      `${origin}/api/v1/skills/02-team-operation/file?path=SKILL.md&ownerHandle=preview-seeded-owner`,
      `${origin}/`,
    ]);
    expect(analyticsProof).toHaveBeenCalledExactlyOnceWith(
      origin,
      "fixture-read-credential",
      sha,
      expect.any(Object),
    );
    expect(receipt).toMatchObject({
      status: "passed",
      git_sha: sha,
      source_activation: true,
      fixture: { slug: "02-team-operation", owner: "preview-seeded-owner" },
    });
    expect(JSON.stringify(receipt)).not.toContain("fixture-read-credential");
  });
  it("does not continue or fabricate success when the actual fixture is absent", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("missing", { status: 404 }));
    const analyticsProof = vi.fn();
    await expect(
      runPreviewProof({ env, fetchImpl, analyticsProof, readHead: () => sha }),
    ).rejects.toThrow(/FIXTURE_LOOKUP_FAILED/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(analyticsProof).not.toHaveBeenCalled();
  });
  it("retains the required nonempty file and homepage checks", async () => {
    for (const [file, home, error] of [
      ["", "<title>ClawHub</title>", "FILE_EMPTY"],
      ["# Skill", "wrong page", "HOME_INVALID"],
    ]) {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(detail))
        .mockResolvedValueOnce(new Response(file))
        .mockResolvedValueOnce(new Response(home));
      const analyticsProof = vi.fn();
      await expect(
        runPreviewProof({ env, fetchImpl, analyticsProof, readHead: () => sha }),
      ).rejects.toThrow(error);
      expect(analyticsProof).not.toHaveBeenCalled();
    }
  });
  it("fails before requests on a wrong head or missing configured selector", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      runPreviewProof({ env, fetchImpl, readHead: () => "b".repeat(40) }),
    ).rejects.toThrow(/CHECKOUT_SHA/);
    await expect(
      runPreviewProof({
        env: { ...env, CLAWHUB_E2E_SKILL_SLUG: "" },
        fetchImpl,
        readHead: () => sha,
      }),
    ).rejects.toThrow(/FIXTURE_SELECTOR/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// This is a dummy canary, never a real credential. Check the bytes of the exact
// receipt path uploaded by the workflow, as well as the final stdout writer.
it.each([
  "timeout",
  "network",
  "browser-timeout",
  "browser-network",
  "browser-read",
  "browser-fulfill",
  "non-error-rejection",
])("discards credential-bearing %s failures before final receipt and stdout", async (kind) => {
  const { mkdir, mkdtemp, readFile, rm } = await import("node:fs/promises");
  await mkdir(".artifacts", { recursive: true });
  const dir = await mkdtemp(".artifacts/preview-proof-canary-");
  const canary = "DUMMY_READ_CREDENTIAL_CANARY_51204";
  const raw = `${kind}\nCall log:\n - x-vercel-protection-bypass: ${canary}`;
  const stdout: string[] = [];
  const fetchImpl = vi.fn<typeof fetch>();
  const analyticsProof = vi.fn();
  if (kind.startsWith("browser-")) {
    fetchImpl
      .mockResolvedValueOnce(Response.json(detail))
      .mockResolvedValueOnce(new Response("# Skill"))
      .mockResolvedValueOnce(new Response("<title>ClawHub</title>"));
    analyticsProof.mockImplementation(async (_origin, _credential, _sha, evidence) => {
      const errors: string[] = [];
      const failures: Parameters<typeof routePreviewRequest>[5] = [];
      evidence.browser_route_failures = failures;
      const route = {
        request: () => ({
          url: () => `${origin}/api/private-${canary}?secret=${canary}`,
          allHeaders: async () => ({}),
          method: () => "GET",
          postDataBuffer: () => null,
        }),
        abort: vi.fn().mockResolvedValue(undefined),
        fulfill: vi.fn().mockRejectedValue(new Error(raw)),
      } as unknown as Route;
      const browserFetch = vi.fn<typeof fetch>();
      if (kind === "browser-read") {
        const response = new Response("body");
        vi.spyOn(response, "arrayBuffer").mockRejectedValue(new Error(raw));
        browserFetch.mockResolvedValue(response);
      } else if (kind === "browser-fulfill") browserFetch.mockResolvedValue(new Response("body"));
      else
        browserFetch.mockRejectedValue(
          Object.assign(new Error(raw), {
            name: kind === "browser-timeout" ? "TimeoutError" : "Error",
          }),
        );
      await routePreviewRequest(route, origin, canary, [], errors, failures, browserFetch);
      expect(errors).toEqual(["BROWSER_ROUTE_FAILED"]);
      expect(failures).toEqual([
        {
          path_class: "api",
          phase:
            kind === "browser-read" ? "read" : kind === "browser-fulfill" ? "fulfill" : "fetch",
          status: kind === "browser-read" || kind === "browser-fulfill" ? 200 : null,
          elapsed_ms: expect.any(Number),
        },
      ]);
      if (errors.length) throw new PreviewProofFailure("BROWSER_ROUTE_FAILED");
    });
  } else fetchImpl.mockRejectedValue(kind === "non-error-rejection" ? raw : new Error(raw));
  try {
    const result = await runAndWritePreviewProof(
      {
        env: { ...env, VERCEL_AUTOMATION_BYPASS_SECRET: canary },
        fetchImpl,
        analyticsProof,
        readHead: () => sha,
      },
      `${dir}/preview-proof.json`,
      (text) => stdout.push(text),
    );
    const bytes = await readFile(`${dir}/preview-proof.json`, "utf8");
    expect(result.status).toBe("failed");
    expect(JSON.parse(bytes).error_code).toBeTypeOf("string");
    for (const output of [bytes, ...stdout]) {
      expect(output).not.toContain(canary);
      expect(output).not.toContain("x-vercel-protection-bypass");
      expect(output).not.toContain("Call log");
      expect(output).not.toContain("stack");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("fails closed rather than publishing returned data containing the read credential", async () => {
  const { mkdir, mkdtemp, readFile, rm } = await import("node:fs/promises");
  await mkdir(".artifacts", { recursive: true });
  const dir = await mkdtemp(".artifacts/preview-proof-canary-");
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(detail))
    .mockResolvedValueOnce(new Response("# Skill"))
    .mockResolvedValueOnce(new Response("<title>ClawHub</title>"));
  const stdout: string[] = [];
  try {
    const receipt = await runAndWritePreviewProof(
      {
        env,
        fetchImpl,
        readHead: () => sha,
        analyticsProof: vi
          .fn()
          .mockResolvedValue({ unexpected: env.VERCEL_AUTOMATION_BYPASS_SECRET }),
      },
      `${dir}/preview-proof.json`,
      (text) => stdout.push(text),
    );
    expect(receipt).toEqual({ status: "failed", error_code: "CREDENTIAL_IN_PROOF_OUTPUT" });
    expect(await readFile(`${dir}/preview-proof.json`, "utf8")).not.toContain(
      env.VERCEL_AUTOMATION_BYPASS_SECRET,
    );
    expect(stdout.join()).not.toContain(env.VERCEL_AUTOMATION_BYPASS_SECRET);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
