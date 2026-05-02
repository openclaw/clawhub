type PackageLifecycleState =
  | "needs-input"
  | "metadata-blocked"
  | "ready-to-submit"
  | "uploading"
  | "publishing"
  | "scan-pending"
  | "clawpack-missing"
  | "ready"
  | "revoked"
  | "blocked"
  | "failed";

type PackageLifecycleSeverity = "neutral" | "info" | "success" | "warning" | "danger";

type PackageLifecycleStepStatus = "waiting" | "active" | "done" | "blocked";

type PackageLifecycleStep = {
  key: string;
  label: string;
  status: PackageLifecycleStepStatus;
};

type PackageLifecycle = {
  state: PackageLifecycleState;
  label: string;
  description: string;
  severity: PackageLifecycleSeverity;
  action: string | null;
  steps: PackageLifecycleStep[];
};

type ScanStatus = string | null | undefined;

const DONE_STEPS = {
  upload: { key: "upload", label: "Upload", status: "done" },
  manifest: { key: "manifest", label: "Manifest", status: "done" },
  build: { key: "build", label: "Build", status: "done" },
  scan: { key: "scan", label: "Scan", status: "done" },
  available: { key: "available", label: "Available", status: "done" },
} satisfies Record<string, PackageLifecycleStep>;

function step(
  key: string,
  label: string,
  status: PackageLifecycleStepStatus,
): PackageLifecycleStep {
  return { key, label, status };
}

function normalizeScanStatus(...statuses: ScanStatus[]) {
  const normalized = statuses
    .map((status) => status?.trim().toLowerCase())
    .filter((status): status is string => Boolean(status));
  if (normalized.some((status) => status === "malicious" || status === "blocked")) {
    return "malicious";
  }
  if (normalized.some((status) => status === "suspicious")) return "suspicious";
  if (normalized.some((status) => status === "pending" || status === "queued")) return "pending";
  if (normalized.some((status) => status === "error" || status === "failed")) return "failed";
  if (normalized.length === 0 || normalized.some((status) => status === "not-run")) {
    return "not-run";
  }
  if (normalized.every((status) => status === "clean" || status === "harmless")) return "clean";
  return "pending";
}

function lifecycle(input: Omit<PackageLifecycle, "steps"> & { steps: PackageLifecycleStep[] }) {
  return input;
}

export function derivePublishLifecycle(input: {
  hasFiles: boolean;
  isAuthenticated: boolean;
  blockers: string[];
  status: string | null;
}): PackageLifecycle {
  if (!input.hasFiles) {
    return lifecycle({
      state: "needs-input",
      label: "Waiting for package",
      description:
        "Upload a plugin folder, archive, or package source before metadata is editable.",
      severity: "neutral",
      action: "Choose a package source.",
      steps: [
        step("upload", "Upload", "active"),
        step("manifest", "Manifest", "waiting"),
        step("build", "Build", "waiting"),
        step("scan", "Scan", "waiting"),
        step("available", "Available", "waiting"),
      ],
    });
  }

  if (input.status?.toLowerCase().includes("uploading")) {
    return lifecycle({
      state: "uploading",
      label: "Uploading files",
      description: "Package files are being written to ClawHub storage.",
      severity: "info",
      action: null,
      steps: [
        step("upload", "Upload", "active"),
        step("manifest", "Manifest", "done"),
        step("build", "Build", "waiting"),
        step("scan", "Scan", "waiting"),
        step("available", "Available", "waiting"),
      ],
    });
  }

  if (input.status?.toLowerCase().includes("publishing")) {
    return lifecycle({
      state: "publishing",
      label: "Building Claw Pack",
      description: "ClawHub is creating the canonical Claw Pack artifact and release record.",
      severity: "info",
      action: null,
      steps: [
        DONE_STEPS.upload,
        DONE_STEPS.manifest,
        step("build", "Build", "active"),
        step("scan", "Scan", "waiting"),
        step("available", "Available", "waiting"),
      ],
    });
  }

  if (input.status?.toLowerCase().includes("pending security")) {
    return lifecycle({
      state: "scan-pending",
      label: "Published, scan pending",
      description:
        "The release exists, but public confidence depends on security checks finishing.",
      severity: "warning",
      action: "Watch the release until scans clear.",
      steps: [
        DONE_STEPS.upload,
        DONE_STEPS.manifest,
        DONE_STEPS.build,
        step("scan", "Scan", "active"),
        step("available", "Available", "waiting"),
      ],
    });
  }

  if (!input.isAuthenticated) {
    return lifecycle({
      state: "metadata-blocked",
      label: "Login required",
      description: "The package is parsed, but publishing requires an authenticated ClawHub user.",
      severity: "warning",
      action: "Log in before publishing.",
      steps: [
        DONE_STEPS.upload,
        DONE_STEPS.manifest,
        step("build", "Build", "blocked"),
        step("scan", "Scan", "waiting"),
        step("available", "Available", "waiting"),
      ],
    });
  }

  if (input.blockers.length > 0) {
    return lifecycle({
      state: "metadata-blocked",
      label: "Blocked before publish",
      description: "ClawHub can preview the Claw Pack, but required metadata is incomplete.",
      severity: "danger",
      action: input.blockers[0] ?? "Resolve the blocking metadata.",
      steps: [
        DONE_STEPS.upload,
        step("manifest", "Manifest", "blocked"),
        step("build", "Build", "waiting"),
        step("scan", "Scan", "waiting"),
        step("available", "Available", "waiting"),
      ],
    });
  }

  return lifecycle({
    state: "ready-to-submit",
    label: "Ready to publish",
    description: "Metadata and package files are ready for the canonical Claw Pack build.",
    severity: "success",
    action: "Publish to start build and security checks.",
    steps: [
      DONE_STEPS.upload,
      DONE_STEPS.manifest,
      step("build", "Build", "waiting"),
      step("scan", "Scan", "waiting"),
      step("available", "Available", "waiting"),
    ],
  });
}

export function deriveClawPackLifecycle(input: {
  available?: boolean | null;
  revokedAt?: number | null;
  buildError?: string | null;
  verificationScanStatus?: ScanStatus;
  vtStatus?: ScanStatus;
  vtVerdict?: ScanStatus;
  llmStatus?: ScanStatus;
  llmVerdict?: ScanStatus;
  staticScanStatus?: ScanStatus;
}): PackageLifecycle {
  if (input.revokedAt) {
    return lifecycle({
      state: "revoked",
      label: "Revoked",
      description: "This Claw Pack has been revoked and should not be installed.",
      severity: "danger",
      action: "Publish a replacement release or keep the artifact unavailable.",
      steps: [
        DONE_STEPS.upload,
        DONE_STEPS.manifest,
        DONE_STEPS.build,
        step("scan", "Scan", "blocked"),
        step("available", "Available", "blocked"),
      ],
    });
  }

  if (input.buildError) {
    return lifecycle({
      state: "failed",
      label: "Build failed",
      description: input.buildError,
      severity: "danger",
      action: "Retry the Claw Pack build after fixing the source package.",
      steps: [
        DONE_STEPS.upload,
        DONE_STEPS.manifest,
        step("build", "Build", "blocked"),
        step("scan", "Scan", "waiting"),
        step("available", "Available", "waiting"),
      ],
    });
  }

  if (!input.available) {
    return lifecycle({
      state: "clawpack-missing",
      label: "Claw Pack missing",
      description: "The release exists but does not have a generated Claw Pack artifact yet.",
      severity: "warning",
      action: "Run or retry Claw Pack artifact backfill.",
      steps: [
        DONE_STEPS.upload,
        step("manifest", "Manifest", "waiting"),
        step("build", "Build", "active"),
        step("scan", "Scan", "waiting"),
        step("available", "Available", "waiting"),
      ],
    });
  }

  const scanStatus = normalizeScanStatus(
    input.verificationScanStatus,
    input.vtStatus,
    input.vtVerdict,
    input.llmStatus,
    input.llmVerdict,
    input.staticScanStatus,
  );

  if (scanStatus === "malicious" || scanStatus === "suspicious") {
    return lifecycle({
      state: "blocked",
      label: scanStatus === "malicious" ? "Blocked as malicious" : "Needs review",
      description: "The Claw Pack exists, but security signals prevent a clean install decision.",
      severity: "danger",
      action: "Open moderation evidence and resolve or revoke the artifact.",
      steps: [
        DONE_STEPS.upload,
        DONE_STEPS.manifest,
        DONE_STEPS.build,
        step("scan", "Scan", "blocked"),
        step("available", "Available", "blocked"),
      ],
    });
  }

  if (scanStatus === "failed" || scanStatus === "pending" || scanStatus === "not-run") {
    return lifecycle({
      state: "scan-pending",
      label: "Scan pending",
      description:
        "The Claw Pack is built, but all security checks have not reached a clean state.",
      severity: "warning",
      action: "Wait for scans or request a rescan if this is stale.",
      steps: [
        DONE_STEPS.upload,
        DONE_STEPS.manifest,
        DONE_STEPS.build,
        step("scan", "Scan", "active"),
        step("available", "Available", "waiting"),
      ],
    });
  }

  return lifecycle({
    state: "ready",
    label: "Ready",
    description: "The Claw Pack is built and current security signals are clean.",
    severity: "success",
    action: null,
    steps: [
      DONE_STEPS.upload,
      DONE_STEPS.manifest,
      DONE_STEPS.build,
      DONE_STEPS.scan,
      DONE_STEPS.available,
    ],
  });
}
