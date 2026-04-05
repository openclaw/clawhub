import { describe, expect, it } from "vitest";
import { deriveSkillCapabilityTags } from "./skillCapabilityTags";

describe("deriveSkillCapabilityTags", () => {
  it("detects wallet, payment, and transaction authority from crypto skills", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "paytoll",
      displayName: "PayToll",
      summary: "DeFi tools paid with x402 micro-payments.",
      frontmatter: {
        "requires.env": ["PRIVATE_KEY"],
      },
      readmeText:
        "Payment is the auth. Each tool call costs USDC. The wallet private key signs EIP-712 payment authorizations.",
      fileContents: [
        {
          path: "src/executor.ts",
          content:
            "walletClient.sendTransaction({}); if (result.type === 'approval_required') { log('Sending approval transaction...'); }",
        },
      ],
    });

    expect(tags).toEqual([
      "crypto",
      "requires-wallet",
      "can-make-purchases",
      "can-sign-transactions",
    ]);
  });

  it("detects OAuth-backed external posting behavior", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "social-poster",
      displayName: "Social Poster",
      frontmatter: {},
      readmeText:
        "Post a tweet for the user. Requires an OAuth 2.0 access token with tweet.write scope.",
      fileContents: [],
    });

    expect(tags).toEqual(["requires-oauth-token", "posts-externally"]);
  });

  it("does not treat generic broadcast wording as a crypto transaction signal", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "notify-bot",
      displayName: "Notify Bot",
      frontmatter: {},
      readmeText: "Broadcast notifications to Slack and email when incidents are opened.",
      fileContents: [],
    });

    expect(tags).toEqual([]);
  });
});
