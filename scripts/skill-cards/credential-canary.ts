import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { getFunctionName } from "convex/server";
import { processJob, skillCardGenerationSettings } from "./run-skill-card-worker";

// This route never constructs a backend client. The same worker generates and
// validates one fixed, benign artifact; its completion stays in this process.
assert.ok(process.env.SECURITY_SCAN_WORKER_TOKEN === undefined);
assert.ok(process.env.CONVEX_DEPLOY_KEY === undefined);
assert.ok(process.env.CONVEX_URL === undefined);
assert.ok(process.env.VITE_CONVEX_URL === undefined);
const settings = skillCardGenerationSettings();
assert.deepEqual(settings, {
  model: "gpt-6-sol",
  reasoningEffort: "medium",
  serviceTier: "fast",
});
const skill =
  "# Greeting helper\n\nWrite a friendly greeting. No tools or network access are needed.\n";
let completed = 0;
const ok = await processJob(
  {
    action: async (reference, args) => {
      assert.equal(getFunctionName(reference), "skillCards:completeSkillCardJob");
      assert.equal(typeof args.markdown, "string");
      assert.ok(args.markdown.length > 100);
      assert.match(args.markdown, /greeting/i);
      completed += 1;
      return { ok: true };
    },
  },
  "fixture-only-no-backend-credential",
  {
    job: { _id: "credential-canary", leaseToken: "fixture-lease", source: "manual" },
    target: {
      skill: { slug: "greeting-fixture", displayName: "Greeting helper" },
      version: { version: "1.0.0" },
      evidence: {
        schemaVersion: 1,
        publisher: { handle: "fixture-publisher", displayName: "Fixture publisher", kind: "user" },
        provenance: { source: "unavailable" },
        skill: {
          slug: "greeting-fixture",
          displayName: "Greeting helper",
          summary: "Write a greeting.",
        },
        release: { version: "1.0.0", changelog: "Initial benign fixture." },
        license: "MIT-0",
        security: {
          source: "clawscan",
          verdict: "benign",
          summary: "Text-only fixture.",
          riskFindings: [],
        },
      },
      files: [
        {
          path: "SKILL.md",
          url: `data:text/markdown;base64,${Buffer.from(skill).toString("base64")}`,
          size: Buffer.byteLength(skill),
          sha256: createHash("sha256").update(skill).digest("hex"),
          contentType: "text/markdown",
        },
      ],
    },
  },
  resolve(".artifacts/nvidia-trustworthy-ai"),
  settings,
);
assert.equal(ok, true);
assert.equal(completed, 1);
console.log(JSON.stringify({ ...settings, completed, renderedCardValidated: true }));
