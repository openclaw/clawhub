/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateBlobster } from "./blobsterGeneration";

const design = {
  version: 1,
  id: "gardener",
  name: "Gardener",
  description: "A friendly gardener",
  palette: { shell: "#87b891", claw: "#5b9471", glint: "#fff0b3" },
  layers: {
    back: "",
    left_prop: "",
    right_prop: "",
    shell_overlay: '<rect x="40" y="50" width="40" height="30" fill="#f1e4c4"/>',
    accessory: "",
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Blobster generation", () => {
  function provider(output: unknown) {
    const fetcher = vi.fn(async () =>
      Response.json({
        output: [
          { type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }

  it("submits only approved text and renders validated provider output", async () => {
    const fetcher = provider(design);
    vi.stubEnv("OPENAI_BLOBSTER_MODEL", "test-model");
    const result = await generateBlobster("A helpful gardener", "test-key");
    const [, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.input).toBe("A helpful gardener");
    expect(body.store).toBe(false);
    expect(body.model).toBe("test-model");
    expect(body.text.format.type).toBe("json_schema");
    expect(result.svg).toContain('fill="#f1e4c4"');
    expect(result.name).toBe("Gardener");
  });

  it("rejects active markup even inside schema-conforming output", async () => {
    provider({ ...design, layers: { ...design.layers, accessory: "<script>alert(1)</script>" } });
    await expect(generateBlobster("gardener", "test-key")).rejects.toThrow("Unsupported SVG");
  });

  it("rejects provider errors and refusals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("secret upstream error", { status: 500 })),
    );
    await expect(generateBlobster("gardener", "test-key")).rejects.toThrow(
      "Blobster generation failed",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ output: [] })),
    );
    await expect(generateBlobster("gardener", "test-key")).rejects.toThrow(
      "Invalid Blobster design",
    );
  });
});
