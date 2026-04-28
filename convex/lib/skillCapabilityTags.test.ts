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
      "requires-sensitive-credentials",
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

    expect(tags).toEqual([
      "requires-oauth-token",
      "requires-sensitive-credentials",
      "posts-externally",
    ]);
  });

  it("detects non-oauth API key skills that still need sensitive credentials", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "minimax-usage",
      displayName: "Minimax Usage",
      frontmatter: {},
      readmeText:
        "Create a .env file with MINIMAX_CODING_API_KEY and MINIMAX_GROUP_ID, then send an authorization: Bearer header to the MiniMax endpoint.",
      fileContents: [],
    });

    expect(tags).toEqual(["requires-sensitive-credentials"]);
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

  it("does not treat generic web font display swap wording as a crypto signal", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "landing-page",
      displayName: "Landing Page",
      frontmatter: {},
      readmeText:
        "Loads Google Fonts with display=swap so text renders quickly while custom fonts load.",
      fileContents: [
        {
          path: "src/styles.css",
          content:
            "@import url('https://fonts.googleapis.com/css2?family=Inter&display=swap');",
        },
      ],
    });

    expect(tags).toEqual([]);
  });

  it("still detects token swap wording as a crypto signal", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "token-router",
      displayName: "Token Router",
      frontmatter: {},
      readmeText: "Find the best route to swap USDC for ETH across supported pools.",
      fileContents: [],
    });

    expect(tags).toEqual(["crypto"]);
  });
});
