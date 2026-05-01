import { describe, expect, it } from "vitest";
import { derivePublishLifecycle, deriveStorePackLifecycle } from "./packageLifecycle";

describe("package lifecycle", () => {
  it("marks publish as blocked when StorePack preview has blockers", () => {
    const lifecycle = derivePublishLifecycle({
      hasFiles: true,
      isAuthenticated: true,
      blockers: ["Source commit is required."],
      status: null,
    });

    expect(lifecycle.state).toBe("metadata-blocked");
    expect(lifecycle.label).toBe("Blocked before publish");
    expect(lifecycle.steps.find((step) => step.key === "manifest")?.status).toBe("blocked");
  });

  it("tracks the post-publish scan pending state", () => {
    const lifecycle = derivePublishLifecycle({
      hasFiles: true,
      isAuthenticated: true,
      blockers: [],
      status: "Published. Pending security checks and verification before public listing.",
    });

    expect(lifecycle.state).toBe("scan-pending");
    expect(lifecycle.steps.find((step) => step.key === "scan")?.status).toBe("active");
  });

  it("keeps built StorePacks pending until scans are clean", () => {
    const lifecycle = deriveStorePackLifecycle({
      available: true,
      verificationScanStatus: "clean",
      vtStatus: "not-run",
      staticScanStatus: "clean",
    });

    expect(lifecycle.state).toBe("scan-pending");
    expect(lifecycle.action).toMatch(/Wait for scans/i);
  });

  it("marks clean built StorePacks as ready", () => {
    const lifecycle = deriveStorePackLifecycle({
      available: true,
      verificationScanStatus: "clean",
      vtStatus: "clean",
      llmStatus: "clean",
      staticScanStatus: "clean",
    });

    expect(lifecycle.state).toBe("ready");
    expect(lifecycle.steps.every((step) => step.status === "done")).toBe(true);
  });

  it("keeps suspicious StorePacks blocked even when the artifact exists", () => {
    const lifecycle = deriveStorePackLifecycle({
      available: true,
      verificationScanStatus: "suspicious",
      vtStatus: "clean",
    });

    expect(lifecycle.state).toBe("blocked");
    expect(lifecycle.severity).toBe("danger");
  });
});
