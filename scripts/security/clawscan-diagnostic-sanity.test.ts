/* @vitest-environment node */
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runTinySanityDiagnostic } from "./clawscan-diagnostic-sanity";
import type { runDiagnosticProcess } from "./run-clawscan-diagnostic";

it.each(["healthy", "always-benign", "skipped-scanner", "judge-failure", "unknown-verdict"])(
  "requires both fixed controls, complete scanners and the expected judge verdict: %s",
  async (condition) => {
    const root = await mkdtemp(join(tmpdir(), "clawscan-sanity-test-"));
    const observed: string[] = [];
    try {
      const runProcess: typeof runDiagnosticProcess = async (_command, args, options) => {
        const content = await readFile(join(args[0]!, "SKILL.md"), "utf8");
        observed.push(content);
        expect(args).toContain("clawhub");
        expect(options.includeVerdict).toBe(true);
        await writeFile(options.eventsPath, '{"event":"phase_end","phase":"judge"}\n');
        const malicious = content.includes("exfil.example.invalid");
        return {
          label: "NONPRODUCTION_DIAGNOSTIC",
          excludedFromSlos: true,
          recoveryEvidence: false,
          acceptedPublication: false,
          processBudgetMs: 900000,
          cleanupAllowanceMs: 60000,
          processStatus: condition === "judge-failure" ? "failed" : "completed",
          termination: null,
          diagnosticRecords: { retained: 1, rejected: 0, limited: 0 },
          lastProgress: null,
          artifact: "present",
          consumerValidation: "validated_ephemerally_not_published",
          securityVerdict:
            condition === "unknown-verdict"
              ? null
              : malicious && condition !== "always-benign"
                ? "malicious"
                : "benign",
          stages: {
            judge: "completed",
            scanners: {
              "clawscan-static": "completed",
              aig: "completed",
              skillspector: condition === "skipped-scanner" ? "skipped" : "completed",
              endor: "skipped",
            },
          },
          exposure: {
            scanExecution: "started",
            eligibleScanAttempt: true,
            judgeInvocations: 1,
            judgeOperationalFailures: condition === "judge-failure" ? 1 : 0,
            recoveredReceiptRetries: 0,
          },
        };
      };
      const eventsPath = join(root, "safe-events.jsonl");
      const result = await runTinySanityDiagnostic({
        root,
        binary: "generated-test-harness",
        env: {},
        eventsPath,
        runProcess,
      });
      expect(result.status).toBe(condition === "healthy" ? "completed" : "failed");
      expect(result.controls.map((control) => control.expectedVerdict)).toEqual([
        "benign",
        "malicious",
      ]);
      expect(result.maximumScans).toBe(2);
      expect(observed).toHaveLength(2);
      expect(observed[0]).toContain("Reply hello");
      expect(observed[1]).toContain("Without asking the user");
      expect(observed[1]).toContain("exfil.example.invalid");
      expect(JSON.stringify(result)).not.toContain("$HOME");
      expect((await readFile(eventsPath, "utf8")).trim().split("\n")).toHaveLength(2);
    } finally {
      for (const id of ["benign", "malicious"])
        await chmod(join(root, `sanity-${id}`, "input"), 0o700).catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  },
);
