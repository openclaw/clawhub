/* @vitest-environment node */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("staging worker relays", () => {
  it.each([
    ["prepublication-publish-checks", "prepublication-publish-checks"],
    ["security-scan-codex", "codex-security-scan"],
  ])(
    "routes %s events to staging without exposing worker secrets",
    async (workflowName, jobName) => {
      const workflow = parse(await readFile(`.github/workflows/${workflowName}.yml`, "utf8"));
      const relay = workflow.jobs["dispatch-staging"];
      const worker = workflow.jobs[jobName];
      expect(relay.if).toContain("github.event_name == 'repository_dispatch'");
      expect(relay.if).toContain("github.event.client_payload.environment == 'staging'");
      expect(relay.permissions).toEqual({ actions: "write" });
      expect(relay.environment).toBeUndefined();
      expect(JSON.stringify(relay)).not.toContain("secrets.");
      expect(worker.if).toContain("github.event.client_payload.environment != 'staging'");
      expect(worker.if).toContain(
        "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/staging'",
      );
      expect(worker.environment).toBe(
        workflowName === "prepublication-publish-checks"
          ? "${{ github.ref == 'refs/heads/staging' && 'Staging' || (github.ref == 'refs/heads/main' && inputs['target-environment'] == 'test' && 'Test' || 'Production') }}"
          : "${{ github.ref == 'refs/heads/staging' && 'Staging' || 'Production' }}",
      );
      const guard = worker.steps.findIndex(
        (step: { name?: string }) => step.name === "Verify staging worker target",
      );
      const firstSecret = worker.steps.findIndex((step: unknown) =>
        JSON.stringify(step).includes("secrets."),
      );
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(firstSecret);

      const dir = await mkdtemp(join(tmpdir(), "staging-relay-"));
      try {
        await writeFile(join(dir, "gh"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 });
        const args = execFileSync("/bin/bash", ["-c", relay.steps[0].run], {
          encoding: "utf8",
          env: {
            PATH: dir,
            ATTEMPT_ID: "staging-attempt",
            KIND: "skill",
            SLUG: '$(exit 99); staging "slug"',
            VERSION: "1.0.0",
            BATCH_LIMIT: "1",
            MAX_JOBS: "1",
            MAX_RUNTIME_MINUTES: "20",
          },
        })
          .trim()
          .split("\n");
        expect(args.slice(0, 7)).toEqual([
          "workflow",
          "run",
          `${workflowName}.yml`,
          "--repo",
          "openclaw/clawhub",
          "--ref",
          "staging",
        ]);
        if (workflowName === "prepublication-publish-checks") {
          expect(args).toContain('slug=$(exit 99); staging "slug"');
          expect(args).toContain("attempt-id=staging-attempt");
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
