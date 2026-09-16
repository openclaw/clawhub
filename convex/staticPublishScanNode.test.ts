import { describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import { REASON_CODES } from "./lib/moderationReasonCodes";
import { runStaticPublishScanInternal } from "./staticPublishScanNode";

type Handler = (ctx: ActionCtx, args: unknown) => Promise<unknown>;

describe("runStaticPublishScanInternal", () => {
  it("runs the moderation scan against the files it is handed and returns the verdict", async () => {
    const storageGet = vi.fn(
      async () => new Blob([new TextEncoder().encode("const token = eval(input);\n")]),
    );
    const result = (await (
      runStaticPublishScanInternal as unknown as { _handler: Handler }
    )._handler({ storage: { get: storageGet } } as unknown as ActionCtx, {
      slug: "demo-plugin",
      displayName: "Demo Plugin",
      // `$schema` is exactly what Convex values reject as an object key; the
      // JSON transport must deliver it, and the shortener URL, to the scan intact.
      metadataJson: JSON.stringify({
        packageJson: {
          $schema: "https://json.schemastore.org/package.json",
          name: "demo-plugin",
          version: "1.0.0",
          homepage: "https://bit.ly/demo-plugin",
        },
      }),
      files: [{ path: "dist/index.js", size: 27, storageId: "storage:1" }],
    })) as { status: string; reasonCodes: string[]; engineVersion: string; checkedAt: number };

    expect(storageGet).toHaveBeenCalledWith("storage:1");
    expect(result.status).toBe("suspicious");
    expect(result.reasonCodes).toContain("suspicious.dynamic_code_execution");
    expect(result.reasonCodes).toContain(REASON_CODES.SUSPICIOUS_INSTALL_SOURCE);
    expect(typeof result.engineVersion).toBe("string");
    expect(result.checkedAt).toBeGreaterThan(0);
  });
});
