import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAnalyticsOperations } from "../lib/analyticsEvents";
import { createGoogleAnalytics } from "../lib/googleAnalytics";
import { InstallCopyButton } from "./InstallCopyButton";

const browser = window as Window & { dataLayer?: IArguments[]; gtag?: unknown };
const pageA = {
  page_location: "https://clawhub.ai/skills",
  page_title: "Skills - ClawHub",
  page_referrer: "",
};
let tracker: ReturnType<typeof createGoogleAnalytics>;
let unregister: () => void;
const epoch = "regional:2026-10-02.v2:notice_opt_out";
function gate(allowed: boolean) {
  document.documentElement.dataset.analyticsAllowed = String(allowed);
  document.documentElement.dataset.analyticsConsentEpoch = allowed ? epoch : "";
  tracker.update(allowed ? pageA : null, "/skills", {
    collectionAllowed: allowed,
    consentEpoch: epoch,
  });
}
function outcomes() {
  return (browser.dataLayer ?? [])
    .map((entry) => Array.from(entry))
    .filter((entry) => entry[1] === "copy_action");
}
beforeEach(() => {
  document.head.innerHTML = "";
  localStorage.clear();
  delete browser.gtag;
  delete browser.dataLayer;
  tracker = createGoogleAnalytics("fixture");
  unregister = registerAnalyticsOperations((workflow) => tracker.captureOperation(workflow));
  gate(true);
});
afterEach(() => {
  cleanup();
  unregister();
  delete browser.gtag;
  delete browser.dataLayer;
  vi.restoreAllMocks();
});
function deferredCopy() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(
        () =>
          new Promise<void>((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      ),
    },
  });
  render(<InstallCopyButton text="never-send-copied-text" analyticsMethod="cli" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  return {
    resolve: async () => act(async () => resolve()),
    reject: async () => act(async () => reject(new Error("private error"))),
  };
}

describe("clipboard operation consent and context", () => {
  it("reports success only after the actual write resolves, with its original safe context", async () => {
    const pending = deferredCopy();
    expect(outcomes()).toHaveLength(0);
    await pending.resolve();
    expect(outcomes()).toHaveLength(1);
    expect(outcomes()[0][2]).toMatchObject({
      ...pageA,
      content_type: "install",
      action_result: "success",
      ui_location: "install",
      method: "cli",
    });
    expect(JSON.stringify(outcomes())).not.toContain("never-send");
  });
  it("reports failure without copied text or raw error", async () => {
    const pending = deferredCopy();
    await pending.reject();
    expect(outcomes()[0][2]).toMatchObject({ action_result: "error" });
    expect(JSON.stringify(outcomes())).not.toContain("private error");
  });
  it("does not replay a copy begun while denied after a later grant", async () => {
    gate(false);
    const pending = deferredCopy();
    gate(true);
    await pending.resolve();
    expect(outcomes()).toHaveLength(0);
    expect(screen.getByText("Copied")).toBeTruthy();
  });
  it("does not replay a consented copy across deny and regrant, even with the same epoch", async () => {
    const pending = deferredCopy();
    gate(false);
    gate(true);
    await pending.resolve();
    expect(outcomes()).toHaveLength(0);
    expect(screen.getByText("Copied")).toBeTruthy();
  });
  it("does not attribute a result from A to B or a later return to A", async () => {
    const pending = deferredCopy();
    tracker.pause();
    tracker.update({ ...pageA, page_location: "https://clawhub.ai/plugins" }, "/plugins", {
      consentEpoch: epoch,
    });
    tracker.update(pageA, "/skills", { consentEpoch: epoch });
    await pending.resolve();
    expect(outcomes()).toHaveLength(0);
  });
  it("drops a completion after resource identity changes on the same path", async () => {
    const pending = deferredCopy();
    tracker.update({ ...pageA, content_id: "another-public-resource" }, "/skills", {
      consentEpoch: epoch,
    });
    await pending.resolve();
    expect(outcomes()).toHaveLength(0);
  });
});
