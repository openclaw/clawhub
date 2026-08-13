import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

describe("Claw feed OpenClaw contract workflow", () => {
  it("runs the real bridge against a pinned OpenClaw source revision", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/ci.yml", "utf8")) as {
      jobs: Record<
        string,
        {
          env?: Record<string, string>;
          steps?: Array<{
            uses?: string;
            with?: Record<string, string>;
            env?: Record<string, string>;
            run?: string;
          }>;
        }
      >;
    };
    const job = workflow.jobs["claws-openclaw-contract"];
    expect(job?.env).toMatchObject({
      OPENCLAW_CONTRACT_REPOSITORY: "openclaw/openclaw",
      OPENCLAW_CONTRACT_SHA: "f8c0e1b8325b1fc36e039cf357a2c4602f76d5aa",
    });
    expect(job?.steps).toContainEqual(
      expect.objectContaining({
        uses: "actions/checkout@v7.0.1",
        with: expect.objectContaining({
          repository: "${{ env.OPENCLAW_CONTRACT_REPOSITORY }}",
          ref: "${{ env.OPENCLAW_CONTRACT_SHA }}",
          path: ".artifacts/openclaw-contract",
        }),
      }),
    );
    expect(job?.steps?.some((step) => step.run?.includes("pnpm install --frozen-lockfile"))).toBe(
      true,
    );
    expect(
      job?.steps?.some(
        (step) =>
          step.env?.OPENCLAW_CLAWS_CHECKOUT ===
            "${{ github.workspace }}/.artifacts/openclaw-contract" &&
          step.run?.includes("claws-feed-openclaw-e2e.test.ts"),
      ),
    ).toBe(true);
  });
});
