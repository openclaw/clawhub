import { describe, expect, it, vi } from "vitest";

const { updateVersionApiKeyRequiredInternal } = await import("./skills");

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const updateVersionApiKeyRequiredInternalHandler = (
  updateVersionApiKeyRequiredInternal as unknown as WrappedHandler<{
    versionId: string;
    apiKeyRequired: boolean;
  }>
)._handler;

function makeCtx(version: Record<string, unknown> | null) {
  const patch = vi.fn(async () => {});
  const get = vi.fn(async (id: string) => {
    if (version && id === version._id) return version;
    return null;
  });
  // triggers.wrapDB binds query/normalizeId unconditionally, so they must
  // exist on the mock even when the handler never calls them.
  const query = vi.fn(() => {
    throw new Error("query() should not be called by updateVersionApiKeyRequiredInternal");
  });
  const normalizeId = vi.fn(() => null);

  return {
    ctx: {
      db: { get, patch, query, normalizeId },
    } as never,
    patch,
    get,
  };
}

describe("updateVersionApiKeyRequiredInternal", () => {
  it("patches the version with apiKeyRequired = true", async () => {
    const version = { _id: "skillVersions:1", skillId: "skills:1" };
    const { ctx, patch, get } = makeCtx(version);

    await updateVersionApiKeyRequiredInternalHandler(ctx, {
      versionId: "skillVersions:1",
      apiKeyRequired: true,
    });

    expect(get).toHaveBeenCalledWith("skillVersions:1");
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("skillVersions:1", { apiKeyRequired: true });
  });

  it("patches the version with apiKeyRequired = false", async () => {
    const version = { _id: "skillVersions:2", skillId: "skills:2" };
    const { ctx, patch } = makeCtx(version);

    await updateVersionApiKeyRequiredInternalHandler(ctx, {
      versionId: "skillVersions:2",
      apiKeyRequired: false,
    });

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("skillVersions:2", { apiKeyRequired: false });
  });

  it("is a no-op when the version cannot be found", async () => {
    const { ctx, patch, get } = makeCtx(null);

    await updateVersionApiKeyRequiredInternalHandler(ctx, {
      versionId: "skillVersions:missing",
      apiKeyRequired: true,
    });

    expect(get).toHaveBeenCalledWith("skillVersions:missing");
    expect(patch).not.toHaveBeenCalled();
  });

  it("does not touch other version fields when patching", async () => {
    const version = {
      _id: "skillVersions:3",
      skillId: "skills:3",
      llmAnalysis: { status: "clean", checkedAt: 1 },
      vtAnalysis: { status: "clean", checkedAt: 1 },
    };
    const { ctx, patch } = makeCtx(version);

    await updateVersionApiKeyRequiredInternalHandler(ctx, {
      versionId: "skillVersions:3",
      apiKeyRequired: true,
    });

    expect(patch).toHaveBeenCalledTimes(1);
    const call = patch.mock.calls[0] as unknown as [string, Record<string, unknown>];
    const patchPayload = call[1];
    expect(Object.keys(patchPayload)).toEqual(["apiKeyRequired"]);
  });
});
