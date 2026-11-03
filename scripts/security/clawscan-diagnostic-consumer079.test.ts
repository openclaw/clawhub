/* @vitest-environment node */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import partialReport from "./fixtures/skillspector-usable-partial.json";
import { diagnosticArtifactMetadata } from "./run-clawscan-diagnostic";
import { validateClawScanArtifactForClawHubProfile } from "./run-codex-scan-worker";

function pluginArtifact() {
  const inspection = {
    version: 2,
    status: "completed",
    challenge: "a".repeat(64),
    required_file: "artifact/openclaw.plugin.json",
    required_file_sha256: "b".repeat(64),
    additional_files_inspected: ["artifact/index.js"],
  };
  const result = {
    verdict: "suspicious",
    confidence: "high",
    summary: "Synthetic scanner gap remains visible",
    dimensions: Object.fromEntries(
      [
        "purpose_capability",
        "instruction_scope",
        "install_mechanism",
        "environment_proportionality",
        "persistence_privilege",
      ].map((name) => [name, { status: "note", detail: "Synthetic finding requires review" }]),
    ),
    scan_findings_in_context: [],
    user_guidance: "Review the retained findings and scanner gaps",
    artifact_inspection: inspection,
  };
  return {
    schemaVersion: "clawscan-run-v1",
    profile: "clawhub",
    target: { kind: "plugin" },
    completedAt: "2026-11-03T00:00:00Z",
    status: "completed",
    complete: true,
    scanners: {
      "clawscan-static": {
        status: "completed",
        raw: { status: "suspicious", findings: ["RETAINED_STATIC_FINDING"] },
      },
      skillspector: {
        status: "partial",
        reportPolicy: "judge-gaps",
        raw: structuredClone(partialReport),
      },
      aig: {
        status: "skipped",
        error: "Scanner aig does not support plugin targets.",
        command: null,
        raw: null,
        exitCode: null,
        commandStarted: false,
      },
    },
    judge: {
      status: "completed",
      error: "",
      result,
      attempts: [
        {
          status: "completed",
          error: "",
          durationMs: 1,
          challenge: inspection.challenge,
          requiredFile: inspection.required_file,
          requiredFileSha256: inspection.required_file_sha256,
          result: structuredClone(result),
        },
      ],
    },
  };
}

async function metadata(artifact: unknown, contract?: "fixed-original079") {
  const root = await mkdtemp(join(tmpdir(), "diagnostic079-consumer-"));
  const path = join(root, "artifact.json");
  const raw = JSON.stringify(artifact);
  try {
    await writeFile(path, raw);
    const result = await diagnosticArtifactMetadata(path, true, contract);
    expect(await readFile(path, "utf8")).toBe(raw);
    return result;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it("accepts the explicit fixed079 plugin skip through the real metadata consumer without rewriting findings", async () => {
  expect(() =>
    validateClawScanArtifactForClawHubProfile(pluginArtifact(), [
      "clawscan-static",
      "skillspector",
    ]),
  ).not.toThrow();
  const result = await metadata(pluginArtifact(), "fixed-original079");
  expect(result).toMatchObject({
    consumerValidation: "validated_ephemerally_not_published",
    securityVerdict: "suspicious",
    stages: { scanners: { aig: "skipped" }, judge: "completed" },
    exposure: { judgeInvocations: 1, judgeOperationalFailures: 0 },
  });
});

it("never infers the fixed079 contract from a skipped plugin artifact", async () => {
  expect((await metadata(pluginArtifact())).consumerValidation).toBe("rejected");
  expect(
    (await metadata(pluginArtifact(), "another-original" as "fixed-original079"))
      .consumerValidation,
  ).toBe("rejected");
});

it("accepts omitted native skip fields as well as null command/raw/exit and false commandStarted", async () => {
  const artifact = pluginArtifact();
  for (const key of ["command", "raw", "exitCode", "commandStarted"])
    delete (artifact.scanners.aig as Record<string, unknown>)[key];
  expect((await metadata(artifact, "fixed-original079")).consumerValidation).toBe(
    "validated_ephemerally_not_published",
  );
});

it.each([
  ["schemaVersion", "wrong"],
  ["profile", "wrong"],
  ["target.kind", "skill"],
  ["target", undefined],
  ["scanners.aig", undefined],
  ["scanners.aig.status", "completed"],
  ["scanners.aig.status", "failed"],
  ["scanners.aig.error", undefined],
  ["scanners.aig.error", "executable missing"],
  ["scanners.aig.command", []],
  ["scanners.aig.raw", {}],
  ["scanners.aig.exitCode", 0],
  ["scanners.aig.commandStarted", true],
  ["scanners.aig.commandStarted", null],
  ["scanners.aig.commandStarted", 0],
  ["scanners.skillspector.status", "failed"],
  ["scanners.skillspector.raw", undefined],
  ["scanners.clawscan-static.status", "failed"],
  ["status", "failed"],
  ["complete", false],
  ["completedAt", "not-a-date"],
  ["judge.status", "failed"],
  ["judge.result.artifact_inspection.version", 1],
  ["judge.result.artifact_inspection.challenge", "c".repeat(64)],
  ["judge.result.artifact_inspection.required_file_sha256", "d".repeat(64)],
  ["judge.result.artifact_inspection.required_file", "artifact/another.json"],
  ["judge.result.artifact_inspection.additional_files_inspected", ["artifact/../outside"]],
  ["judge.attempts", undefined],
  ["judge.attempts.0.result", { verdict: "benign" }],
])(
  "rejects contradictory, missing or tampered %s without weakening normal checks",
  async (path, value) => {
    const artifact = pluginArtifact();
    const parts = path.split(".");
    let parent = artifact as unknown as Record<string, unknown>;
    for (const part of parts.slice(0, -1)) parent = parent[part] as Record<string, unknown>;
    parent[parts.at(-1)!] = value;
    const result = await metadata(artifact, "fixed-original079");
    expect(result.consumerValidation).toBe("rejected");
    expect(result.securityVerdict).toBeNull();
  },
);

it("preserves a valid malicious judgment and all original report bytes", async () => {
  const artifact = pluginArtifact();
  artifact.judge.result.verdict = "malicious";
  artifact.judge.attempts[0].result.verdict = "malicious";
  expect(await metadata(artifact, "fixed-original079")).toMatchObject({
    consumerValidation: "validated_ephemerally_not_published",
    securityVerdict: "malicious",
  });
});

it("keeps the default three-scanner contract accepting completed AIG evidence", async () => {
  const artifact = pluginArtifact();
  Object.assign(artifact.scanners.aig, {
    status: "completed",
    error: "",
    exitCode: 0,
    commandStarted: true,
    raw: {
      version: "2.1.0",
      runs: [{ tool: { driver: { name: "aig-skill-scan" } }, results: [] }],
    },
  });
  expect((await metadata(artifact)).consumerValidation).toBe("validated_ephemerally_not_published");
});
