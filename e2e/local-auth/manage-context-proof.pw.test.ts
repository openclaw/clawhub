import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { buildPluginDetailHref, buildPluginSecurityAuditHref } from "../../src/lib/pluginRoutes";
import {
  expectNoFatalErrorUi,
  expectNoRuntimeErrors,
  trackRuntimeErrors,
  waitForHydration,
} from "../helpers/runtimeErrors";
import { signInAsLocalPersona } from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "local-auth manage context proof requires the local dev auth runner",
);

type CapturedConvexFrame = {
  direction: "in" | "out";
  data: string;
};

type PackageManageContextPayload = {
  package: {
    _id: string;
    name: string;
    displayName: string;
  };
  latestRelease: {
    _id: string;
    version: string;
  };
};

declare global {
  interface Window {
    __clawhubConvexFrames?: CapturedConvexFrame[];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFrameData(data: string) {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

function collectObjects(value: unknown, visit: (value: Record<string, unknown>) => void) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, visit);
    return;
  }
  if (!isRecord(value)) return;
  visit(value);
  for (const item of Object.values(value)) collectObjects(item, visit);
}

function objectHasStringValue(value: Record<string, unknown>, needle: string) {
  return Object.values(value).some((item) => typeof item === "string" && item.includes(needle));
}

function readQueryId(value: Record<string, unknown>) {
  const queryId = value.queryId;
  return typeof queryId === "string" || typeof queryId === "number" ? String(queryId) : null;
}

function isPackageManageContextPayload(value: unknown): value is PackageManageContextPayload {
  if (!isRecord(value) || !isRecord(value.package) || !isRecord(value.latestRelease)) {
    return false;
  }
  return (
    typeof value.package._id === "string" &&
    typeof value.package.name === "string" &&
    typeof value.package.displayName === "string" &&
    typeof value.latestRelease._id === "string" &&
    typeof value.latestRelease.version === "string"
  );
}

function localConvexDeployment() {
  const raw = readFileSync(".convex/local/default/config.json", "utf8");
  const parsed = JSON.parse(raw) as { deploymentName?: unknown };
  if (typeof parsed.deploymentName !== "string" || !parsed.deploymentName) {
    throw new Error("Local Convex deployment name was not available");
  }
  return `local:${parsed.deploymentName}`;
}

function seedLocalModerationFixtures() {
  const result = spawnSync(
    "bunx",
    [
      "convex",
      "run",
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
      "devSeed:seedLocalFixtures",
      JSON.stringify({ reset: true }),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, CONVEX_DEPLOYMENT: localConvexDeployment() },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      [
        "Failed to seed local moderation fixtures.",
        result.stdout.trim(),
        result.stderr.trim(),
      ].join("\n"),
    );
  }
}

function findPackageManageContextPayload(value: unknown): PackageManageContextPayload | null {
  let payload: PackageManageContextPayload | null = null;
  collectObjects(value, (objectValue) => {
    if (!payload && isPackageManageContextPayload(objectValue)) {
      payload = objectValue;
    }
  });
  return payload;
}

function extractManageContextValues(frames: CapturedConvexFrame[]) {
  const queryIds = new Set<string>();
  for (const frame of frames) {
    if (frame.direction !== "out") continue;
    const parsed = parseFrameData(frame.data);
    collectObjects(parsed, (objectValue) => {
      if (!objectHasStringValue(objectValue, "packages:getManageContext")) return;
      const queryId = readQueryId(objectValue);
      if (queryId) queryIds.add(queryId);
    });
  }

  const values: PackageManageContextPayload[] = [];
  for (const frame of frames) {
    if (frame.direction !== "in") continue;
    const parsed = parseFrameData(frame.data);
    collectObjects(parsed, (objectValue) => {
      const queryId = readQueryId(objectValue);
      if (!queryId || !queryIds.has(queryId)) return;
      const payload = findPackageManageContextPayload(objectValue);
      if (payload) values.push(payload);
    });
  }
  return { querySeen: queryIds.size > 0, values };
}

async function installConvexFrameCapture(page: Page) {
  await page.addInitScript(() => {
    const originalWebSocket = window.WebSocket;
    window.__clawhubConvexFrames = [];

    function capture(direction: "in" | "out", data: unknown) {
      if (typeof data !== "string") return;
      window.__clawhubConvexFrames?.push({ direction, data });
    }

    class CapturedWebSocket extends originalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (protocols === undefined) {
          super(url);
        } else {
          super(url, protocols);
        }
        this.addEventListener("message", (event) => capture("in", event.data));
      }

      override send(data: string | Blob | BufferSource) {
        capture("out", data);
        return super.send(data);
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      writable: true,
      value: CapturedWebSocket,
    });
  });
}

async function readConvexFrames(page: Page) {
  return await page.evaluate(() => window.__clawhubConvexFrames ?? []);
}

async function clearConvexFrames(page: Page) {
  await page.evaluate(() => {
    window.__clawhubConvexFrames = [];
  });
}

function expectedManageContextPayload() {
  return {
    package: {
      _id: expect.any(String),
      name: "local-scanned-runtime-plugin",
      displayName: "Local Scanned Runtime Plugin",
    },
    latestRelease: {
      _id: expect.any(String),
      version: "0.1.0",
    },
    suggestedCategories: ["other"],
  };
}

async function expectHealthyManageContextPage(page: Page, errors: string[]) {
  const expectedTransientTimeouts = [
    "CONVEX Q(packages:getManageContext)",
    "CONVEX Q(packages:getActivityTrendForName)",
    "CONVEX Q(packages:canDeleteVersions)",
    "CONVEX Q(packages:getPackageInspectorValidationSummaryPublic)",
    "CONVEX Q(publishers:getMyProfileHandle)",
    "CONVEX M(users:ensure)",
  ];
  await expectNoFatalErrorUi(page);
  await expectNoRuntimeErrors(
    page,
    errors.filter(
      (error) =>
        !(
          error.includes("Function execution timed out (maximum duration: 1s)") &&
          expectedTransientTimeouts.some((functionName) => error.includes(functionName))
        ),
    ),
  );
}

async function expectSlimManageContextPayload(page: Page) {
  await expect
    .poll(async () => extractManageContextValues(await readConvexFrames(page)), {
      timeout: 15_000,
      intervals: [500, 1_000, 2_000],
    })
    .toMatchObject({
      querySeen: true,
      values: expect.arrayContaining([expectedManageContextPayload()]),
    });
  const capture = extractManageContextValues(await readConvexFrames(page));
  const latestValue = capture.values.at(-1);

  expect(latestValue).toEqual(expectedManageContextPayload());
  expect(JSON.stringify(latestValue)).not.toContain("sourceRepo");
  expect(JSON.stringify(latestValue)).not.toContain("latestVersionSummary");
  expect(JSON.stringify(latestValue)).not.toContain("files");
  expect(JSON.stringify(latestValue)).not.toContain("llmAnalysis");
  expect(JSON.stringify(latestValue)).not.toContain("staticScan");
}

async function gotoPluginDetailWithOwnerControls(page: Page) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(
        buildPluginDetailHref("local-scanned-runtime-plugin", { ownerHandle: "local" }),
        {
          waitUntil: "domcontentloaded",
        },
      );
      await waitForHydration(page);
      await expect(
        page.getByRole("heading", { name: "Local Scanned Runtime Plugin" }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("link", { name: "New version" })).toBeVisible({
        timeout: 15_000,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      await page.waitForTimeout(1_000 * attempt);
    }
  }
  throw lastError;
}

test("plugin manage context query returns only slim catalog metadata", async ({ page }) => {
  seedLocalModerationFixtures();
  await installConvexFrameCapture(page);
  const errors = trackRuntimeErrors(page);

  await signInAsLocalPersona(page, "owner");
  const packageName = "local-scanned-runtime-plugin";
  const ownerHandle = "local";
  errors.length = 0;
  await gotoPluginDetailWithOwnerControls(page);

  await expectSlimManageContextPayload(page);

  await clearConvexFrames(page);
  await page.goto(buildPluginSecurityAuditHref(packageName, { ownerHandle }), {
    waitUntil: "domcontentloaded",
  });
  await waitForHydration(page);

  await expect(
    page.getByRole("heading", { name: "Local Scanned Runtime Plugin" }).first(),
  ).toBeVisible();
  await expectSlimManageContextPayload(page);
  await expect(page.getByRole("button", { name: "Rescan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download security audit" })).toBeVisible();

  await expectSlimManageContextPayload(page);

  await expectHealthyManageContextPage(page, errors);
});
