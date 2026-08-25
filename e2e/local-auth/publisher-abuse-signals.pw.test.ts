import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { expect, test, type TestInfo } from "@playwright/test";
import {
  expectNoFatalErrorUi,
  expectNoRuntimeErrors,
  trackRuntimeErrors,
  waitForHydration,
} from "../helpers/runtimeErrors";
import { signInAsLocalPersona } from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "publisher abuse signal workflow requires the local dev auth runner",
);

const EXPLANATION_TOKEN = "a".repeat(64);

type SeededSignal = {
  _id: string;
  attentionState?: string;
  contactState?: string;
  notificationState?: string;
  ownerUserId?: string;
  skillDisplayName: string;
};

type SeededCommunication = {
  signalId: string;
  request: {
    attemptCount?: number;
    requestedAt: number;
    tokenHash?: string;
    state?: string;
    deliveryError?: string;
  };
};

function runConvex(args: string[]) {
  return execFileSync("bunx", ["convex", ...args], {
    encoding: "utf8",
    env: process.env,
  });
}

function seedSignals() {
  runConvex([
    "run",
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
    "publisherAbuseDevSeed:seed",
    "{}",
  ]);
  return JSON.parse(
    runConvex(["data", "publisherAbuseSignals", "--limit", "20", "--format", "json"]),
  ) as SeededSignal[];
}

function readCommunications() {
  return JSON.parse(
    runConvex(["data", "publisherAbuseSignalCommunications", "--limit", "20", "--format", "json"]),
  ) as SeededCommunication[];
}

function capturedEmailCount() {
  const captureFile = process.env.CLAWHUB_EMAIL_CAPTURE_FILE;
  if (!captureFile || !existsSync(captureFile)) return 0;
  return readFileSync(captureFile, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
}

async function capture(
  page: Parameters<typeof trackRuntimeErrors>[0],
  testInfo: TestInfo,
  name: string,
) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test("proves the owner response and staff communication-state workflow", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const runtimeErrors = trackRuntimeErrors(page);
  const signals = seedSignals();
  const queued = signals.find((signal) => signal.contactState === "queued");
  if (!queued) throw new Error("Expected the queued owner-contact fixture");

  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsLocalPersona(page, "abusePublisher");
  const explanationUrl = `/traffic-explanation?signal=${encodeURIComponent(
    queued._id,
  )}&token=${EXPLANATION_TOKEN}`;
  await page.goto(explanationUrl, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { name: "Help us understand this traffic" }),
  ).toBeVisible();
  await expect(page.getByText("No action taken")).toBeVisible();
  await expect(page.getByText("This is not a warning or penalty.")).toBeVisible();
  await capture(page, testInfo, "owner-initial-390");

  await page.getByRole("radio", { name: /Yes, I expected it/ }).check();
  await expect(
    page.getByText("Tell us what you think caused the traffic before submitting."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit explanation" })).toBeDisabled();
  await capture(page, testInfo, "owner-validation-error-390");

  await page
    .getByLabel(/What do you think caused it/)
    .fill("A documentation launch linked directly to this skill.");
  await page.getByRole("button", { name: "Submit explanation" }).click();
  await expect(page.getByRole("heading", { name: "Thanks for the context" })).toBeVisible({
    timeout: 15_000,
  });
  await capture(page, testInfo, "owner-submitted-390");

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByText("Response received")).toBeVisible();
  await expect(
    page.getByText("A documentation launch linked directly to this skill."),
  ).toBeVisible();
  await capture(page, testInfo, "owner-already-submitted-390");

  await page.goto(
    `/traffic-explanation?signal=${encodeURIComponent(queued._id)}&token=${"b".repeat(64)}`,
    { waitUntil: "domcontentloaded" },
  );
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { name: "This traffic request is unavailable" }),
  ).toBeVisible();
  await capture(page, testInfo, "owner-invalid-token-390");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInAsLocalPersona(page, "admin");
  await page.goto("/management?view=abuse&tab=signals", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  for (const name of [
    "Demo Communication — Queued",
    "Demo Communication — Retrying",
    "Demo Communication — Awaiting owner",
    "Demo Communication — Not deliverable",
    "Demo Temporal Download Burst",
    "Demo Communication — Staff alert failed",
  ]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  }
  await capture(page, testInfo, "staff-signal-states-1440");

  await page
    .getByRole("button", { name: "Open details for Demo Communication — Not deliverable" })
    .click();
  await expect(page.getByText("Not deliverable", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Latest failure: resend_error", { exact: true })).toBeVisible();
  await expect(page.getByText("[SECURE EXPLANATION LINK]", { exact: false })).toBeVisible();
  await expect(page.getByText(/ffe054fe7ae0/)).toHaveCount(0);
  await capture(page, testInfo, "staff-contact-failure-detail-1440");

  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Awaiting owner", exact: true }).click();
  await expect(
    page.getByText("Demo Communication — Awaiting owner", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Contact failed", exact: true }).click();
  await expect(
    page.getByText("Demo Communication — Not deliverable", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Needs attention", exact: true }).click();
  await expect(
    page.getByText("Demo Communication — Staff alert failed", { exact: true }),
  ).toBeVisible();

  runConvex([
    "run",
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
    "publisherAbuseDevSeed:expireTrafficExplanationForProof",
    JSON.stringify({ signalId: queued._id }),
  ]);
  await signInAsLocalPersona(page, "abusePublisher");
  await page.goto(explanationUrl, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { name: "This traffic request is unavailable" }),
  ).toBeVisible();
  const expiredCommunicationRetained = readCommunications().some(
    (communication) => communication.signalId === queued._id,
  );
  console.log(
    `Owner expiration boundary trace: ${JSON.stringify({ ownerView: "unavailable", retainedCommunication: expiredCommunicationRetained })}`,
  );
  expect(expiredCommunicationRetained).toBe(true);

  await expectNoFatalErrorUi(page);
  await expectNoRuntimeErrors(page, runtimeErrors);
});

test("cancels a claimed delivery after reassignment before provider I/O", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one real Convex boundary trace is sufficient");

  const signals = seedSignals();
  const queued = signals.find((signal) => signal.contactState === "queued");
  if (!queued?.ownerUserId) throw new Error("Expected the queued owner-contact proof fixture");
  const communication = readCommunications().find((row) => row.signalId === queued._id);
  if (!communication?.request.tokenHash) {
    throw new Error("Expected the queued owner-contact communication fixture");
  }
  const providerRequestsBefore = capturedEmailCount();

  runConvex([
    "run",
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
    "publisherAbuseTrafficExplanation:beginDeliveryAttemptInternal",
    JSON.stringify({
      signalId: queued._id,
      requestedAt: communication.request.requestedAt,
      attemptedAt: Date.now(),
      expectedAttemptCount: communication.request.attemptCount ?? 0,
      tokenHash: communication.request.tokenHash,
      recipientUserId: queued.ownerUserId,
      recipientEmail: "redacted@example.invalid",
      subject: "Redacted traffic explanation proof",
      templateVersion: "traffic-explanation.v1",
      reasonBullets: ["Redacted proof reason"],
      redactedTextSnapshot: "[SECURE EXPLANATION LINK]",
    }),
  ]);
  runConvex([
    "run",
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
    "publisherAbuseDevSeed:reassignTrafficExplanationOwnerForProof",
    JSON.stringify({ signalId: queued._id }),
  ]);
  const actionResult = JSON.parse(
    runConvex([
      "run",
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
      "emailsNode:sendPublisherAbuseTrafficExplanationInternal",
      JSON.stringify({ signalId: queued._id }),
    ]),
  ) as { ok: boolean; reason?: string };
  const finalCommunication = readCommunications().find((row) => row.signalId === queued._id);
  const providerRequests = capturedEmailCount() - providerRequestsBefore;
  const trace = {
    actionResult,
    claimed: true,
    deliveryError: finalCommunication?.request.deliveryError ?? null,
    finalState: finalCommunication?.request.state ?? null,
    providerRequests,
    reassigned: true,
  };
  console.log(`Owner reassignment boundary trace: ${JSON.stringify(trace)}`);

  expect(trace).toEqual({
    actionResult: { ok: false, reason: "skill_owner_changed" },
    claimed: true,
    deliveryError: "skill_owner_changed",
    finalState: "cancelled",
    providerRequests: 0,
    reassigned: true,
  });
});
