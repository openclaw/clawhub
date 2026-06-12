import { describe, expect, it } from "vitest";
import { compareRecommendationStats, computeRecommendationScore } from "./recommendationScore";

describe("recommendationScore", () => {
  it("lets high usage outrank small one-off engagement", () => {
    expect(
      compareRecommendationStats(
        { downloads: 1, installs: 0, stars: 1 },
        { downloads: 43_080, installs: 2, stars: 0 },
      ),
    ).toBeGreaterThan(0);
  });

  it("lets strong download signal beat smaller seeded engagement", () => {
    expect(
      compareRecommendationStats(
        { downloads: 358, installs: 78, stars: 58 },
        { downloads: 43_080, installs: 2, stars: 0 },
      ),
    ).toBeGreaterThan(0);
  });

  it("lets stars contribute without becoming absolute precedence", () => {
    const starred = computeRecommendationScore({ downloads: 100, installs: 5, stars: 5 });
    const unstarred = computeRecommendationScore({ downloads: 100, installs: 5, stars: 0 });

    expect(starred).toBeGreaterThan(unstarred);
  });

  it("weights installs more strongly than downloads", () => {
    const installLed = computeRecommendationScore({ downloads: 0, installs: 10, stars: 0 });
    const downloadLed = computeRecommendationScore({ downloads: 10, installs: 0, stars: 0 });

    expect(installLed).toBeGreaterThan(downloadLed);
  });

  it("compresses large raw counts sublinearly", () => {
    const firstThousand = computeRecommendationScore({ downloads: 1_000, installs: 0, stars: 0 });
    const secondThousand = computeRecommendationScore({
      downloads: 2_000,
      installs: 0,
      stars: 0,
    });

    expect(secondThousand - firstThousand).toBeLessThan(firstThousand);
  });
});
