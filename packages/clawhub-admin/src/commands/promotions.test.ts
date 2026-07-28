/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  createUiModuleMocks,
  makeGlobalOpts,
} from "../../../clawhub/test/cliCommandTestKit.js";

const authTokenMocks = createAuthTokenModuleMocks();
const registryMocks = createRegistryModuleMocks();
const httpMocks = createHttpModuleMocks();
const uiMocks = createUiModuleMocks();

vi.mock("../../../clawhub/src/cli/authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../../../clawhub/src/cli/registry.js", () => registryMocks.moduleFactory());
vi.mock("../../../clawhub/src/http.js", () => httpMocks.moduleFactory());
vi.mock("../../../clawhub/src/cli/ui.js", () => uiMocks.moduleFactory());

const { cmdListPromotions } = await import("./promotions");

const promotion = {
  slug: "example-models-launch",
  title: "Free Example models",
  blurb: "A limited-time free model offer from Example.",
  status: "ended",
  active: false,
  startsAt: 100,
  endsAt: 200,
  models: [{ modelRef: "example-provider/example/model-alpha" }],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("cmdListPromotions", () => {
  it("loads every page for --all", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        promotions: [{ ...promotion, slug: "newer-promotion" }],
        nextCursor: "next page",
      })
      .mockResolvedValueOnce({
        promotions: [{ ...promotion, slug: "older-promotion" }],
        nextCursor: null,
      });

    const result = await cmdListPromotions(makeGlobalOpts(), { all: true });

    expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
      1,
      "https://clawhub.ai",
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/promotions?status=all&limit=100",
        token: "tkn",
      }),
      expect.anything(),
    );
    expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
      2,
      "https://clawhub.ai",
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/promotions?status=all&limit=100&cursor=next%20page",
        token: "tkn",
      }),
      expect.anything(),
    );
    expect(result.promotions.map((entry) => entry.slug)).toEqual([
      "newer-promotion",
      "older-promotion",
    ]);
  });
});
