/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

describe("skills.sh production synchronization workflow", () => {
  it("runs hourly without overlap from main using Production OIDC", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/skills-sh-sync.yml", "utf8")) as {
      concurrency?: { group?: string; "cancel-in-progress"?: boolean };
      jobs: Record<
        string,
        {
          environment?: { name?: string } | string;
          permissions?: Record<string, string>;
          steps?: Array<{
            env?: Record<string, unknown>;
            name?: string;
            run?: string;
            uses?: string;
          }>;
        }
      >;
      on?: {
        schedule?: Array<{ cron?: string }>;
        workflow_dispatch?: unknown;
      };
      permissions?: Record<string, string>;
    };

    expect(workflow.on?.schedule).toEqual([{ cron: "17 * * * *" }]);
    expect(workflow.on?.workflow_dispatch).toBeDefined();
    expect(workflow.concurrency).toEqual({
      group: "skills-sh-production-sync",
      "cancel-in-progress": false,
    });
    expect(workflow.permissions).toEqual({ contents: "read", "id-token": "write" });

    const job = workflow.jobs.sync;
    expect(job?.environment).toEqual({ name: "Production" });
    expect(job?.permissions).toEqual({ contents: "read", "id-token": "write" });
    const run = job?.steps?.map((step) => step.run ?? "").join("\n") ?? "";
    const serializedSteps = JSON.stringify(job?.steps ?? []);
    expect(run).toContain("refs/heads/main");
    expect(serializedSteps).toContain("https://clawhub.ai/ops/skills-sh/mirror");
    expect(run).toContain("bun scripts/skills-sh-catalog/sync.ts");
    expect(run).not.toContain("CLAWHUB_SKILLS_SH_SYNC_TOKEN");
  });
});
