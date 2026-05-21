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
      "financial-authority",
      "requires-wallet",
      "can-make-purchases",
      "can-sign-transactions",
      "requires-sensitive-credentials",
    ]);
  });

  it("treats purchase authority as financial authority, not crypto", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "stripe-credit-buyer",
      displayName: "Stripe Credit Buyer",
      frontmatter: {},
      readmeText:
        "Buy credits for the user's SaaS account through Stripe checkout after explicit approval.",
      fileContents: [],
    });

    expect(tags).toContain("financial-authority");
    expect(tags).toContain("can-make-purchases");
    expect(tags).not.toContain("crypto");
    expect(tags).not.toContain("requires-wallet");
  });

  it("detects payment processing as purchase authority without crypto", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "stripe-payments",
      displayName: "Stripe Payments",
      frontmatter: {},
      readmeText: "Process Stripe payments for customer invoices.",
      fileContents: [],
    });

    expect(tags).toEqual(["financial-authority", "can-make-purchases"]);
  });

  it("detects inflected payment processing verbs without crypto", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "stripe-invoices",
      displayName: "Stripe Invoice Helper",
      frontmatter: {},
      readmeText: "Processes Stripe payments and accepts credit card payments for invoices.",
      fileContents: [],
    });

    expect(tags).toEqual(["financial-authority", "can-make-purchases"]);
  });

  it("detects direct payment actions as purchase authority without crypto", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "vendor-payments",
      displayName: "Vendor Payments",
      frontmatter: {},
      readmeText:
        "Make payments to vendors from the connected Stripe account and pay invoices after approval.",
      fileContents: [],
    });

    expect(tags).toEqual(["financial-authority", "can-make-purchases"]);
  });

  it("detects ordinary ecommerce purchase authority without crypto", () => {
    for (const readmeText of [
      "Purchase products on Amazon after approval.",
      "Purchase a book for the user after approval.",
      "Buy airline tickets for the user after approval.",
      "Order groceries using Instacart after approval.",
    ]) {
      const tags = deriveSkillCapabilityTags({
        slug: "shopping-helper",
        displayName: "Shopping Helper",
        frontmatter: {},
        readmeText,
        fileContents: [],
      });

      expect(tags).toEqual(["financial-authority", "can-make-purchases"]);
    }
  });

  it("detects financially binding purchases outside ordinary ecommerce", () => {
    for (const readmeText of [
      "Purchase domain names after approval.",
      "Purchase software licenses after approval.",
      "Buy gift cards for employees after approval.",
      "Purchase subscriptions after approval.",
      "Purchase plans after approval.",
    ]) {
      const tags = deriveSkillCapabilityTags({
        slug: "procurement-helper",
        displayName: "Procurement Helper",
        frontmatter: {},
        readmeText,
        fileContents: [],
      });

      expect(tags).toEqual(["financial-authority", "can-make-purchases"]);
    }
  });

  it("detects purchase authority from capability and approval phrasing", () => {
    for (const readmeText of [
      "This skill can purchase after approval.",
      "Use when an agent may purchase, book, reserve, subscribe, renew, or upgrade.",
      "Purchase after user approval.",
      "Book hotels after approval.",
      "Books flights after approval.",
      "Reserves rental cars after approval.",
      "Reserve airline tickets after approval.",
      "Subscribes to plans after approval.",
      "Renews domains after approval.",
      "Upgrade memberships after user approval.",
      "Upgrades subscriptions after user approval.",
    ]) {
      const tags = deriveSkillCapabilityTags({
        slug: "approval-purchase-helper",
        displayName: "Approval Purchase Helper",
        frontmatter: {},
        readmeText,
        fileContents: [],
      });

      expect(tags).toEqual(["financial-authority", "can-make-purchases"]);
    }
  });

  it("does not treat non-financial subscribe, reserve, or upgrade verbs as purchases", () => {
    for (const readmeText of [
      "This integration can subscribe to GitHub webhook events.",
      "Use when an agent may subscribe to a GraphQL subscription.",
      "Reserve capacity in Kubernetes after approval.",
      "Upgrade package dependencies after approval.",
      "Can book meeting rooms.",
      "This tool can order search results by relevance.",
      "This skill can order tasks by priority.",
      "This workflow can order support tickets by priority.",
      "Walking outside improves mental health more than most things you can buy.",
      "DOL can order back pay and penalties for wage claims.",
      "Buys groceries that go to waste every week.",
      "State concerns overlap with pending orders alongside committed orders.",
    ]) {
      const tags = deriveSkillCapabilityTags({
        slug: "automation-helper",
        displayName: "Automation Helper",
        frontmatter: {},
        readmeText,
        fileContents: [],
      });

      expect(tags).toEqual([]);
    }
  });

  it("detects card charging as purchase authority without crypto", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "card-billing",
      displayName: "Card Billing",
      frontmatter: {},
      readmeText: "Charge customer cards for approved invoices.",
      fileContents: [],
    });

    expect(tags).toEqual(["financial-authority", "can-make-purchases"]);
  });

  it("treats transaction signing as financial authority, not crypto without crypto evidence", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "bank-transfer-approval",
      displayName: "Bank Transfer Approval",
      frontmatter: {},
      readmeText:
        "Sign and submit bank transfer transactions after the user confirms the payee and amount.",
      fileContents: [],
    });

    expect(tags).toContain("financial-authority");
    expect(tags).toContain("can-sign-transactions");
    expect(tags).toContain("requires-sensitive-credentials");
    expect(tags).not.toContain("crypto");
    expect(tags).not.toContain("requires-wallet");
  });

  it("detects standalone transaction action verbs as financial authority", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "ach-approvals",
      displayName: "ACH Approvals",
      frontmatter: {},
      readmeText: "Approves ACH transactions after user confirmation.",
      fileContents: [],
    });

    expect(tags).toContain("financial-authority");
    expect(tags).toContain("can-sign-transactions");
    expect(tags).toContain("requires-sensitive-credentials");
    expect(tags).not.toContain("crypto");
    expect(tags).not.toContain("requires-wallet");
  });

  it("keeps financial rails tagged when adjacent to internal wording", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "ach-approvals",
      displayName: "ACH Approvals",
      frontmatter: {},
      readmeText: "Approves internal ACH transactions after approval.",
      fileContents: [],
    });

    expect(tags).toEqual([
      "financial-authority",
      "can-sign-transactions",
      "requires-sensitive-credentials",
    ]);
  });

  it("detects standalone crypto transaction sending as wallet authority", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "eth-sender",
      displayName: "ETH Sender",
      frontmatter: {},
      readmeText: "Send Ethereum transactions from a wallet.",
      fileContents: [],
    });

    expect(tags).toEqual([
      "crypto",
      "financial-authority",
      "requires-wallet",
      "can-sign-transactions",
      "requires-sensitive-credentials",
    ]);
  });

  it("detects hyphenated ERC-20 transaction sending as wallet authority", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "token-sender",
      displayName: "Token Sender",
      frontmatter: {},
      readmeText: "Send ERC-20 transactions after approval.",
      fileContents: [],
    });

    expect(tags).toEqual([
      "crypto",
      "financial-authority",
      "requires-wallet",
      "can-sign-transactions",
      "requires-sensitive-credentials",
    ]);
  });

  it("does not treat database transactions as financial transaction authority", () => {
    for (const readmeText of [
      "Executes database transactions in Postgres and rolls back on failure.",
      "Signs database transactions after approval.",
    ]) {
      const tags = deriveSkillCapabilityTags({
        slug: "sql-helper",
        displayName: "SQL Helper",
        frontmatter: {},
        readmeText,
        fileContents: [],
      });

      expect(tags).toEqual([]);
    }
  });

  it("does not treat internal workflow transactions as financial transaction authority", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "workflow-engine",
      displayName: "Workflow Engine",
      frontmatter: {},
      readmeText: "Approves pending transactions in the internal queue.",
      fileContents: [],
    });

    expect(tags).toEqual([]);
  });

  it("does not treat sign in or sign up wording as transaction signing", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "bank-alerts",
      displayName: "Bank Alerts",
      frontmatter: {},
      readmeText:
        "Sign in to view transactions and sign up for transaction alerts on the dashboard.",
      fileContents: [],
    });

    expect(tags).toEqual([]);
  });

  it("does not treat sign out wording as transaction signing", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "bank-session-help",
      displayName: "Bank Session Help",
      frontmatter: {},
      readmeText: "Sign out before viewing transactions on a shared device.",
      fileContents: [],
    });

    expect(tags).toEqual([]);
  });

  it("does not treat sign-in variants as transaction signing", () => {
    for (const readmeText of [
      "Sign into view transactions in the dashboard.",
      "Sign onto the transaction portal before checking balances.",
      "Sign off before viewing transactions on a shared device.",
      "Signs in to view transactions on the dashboard.",
      "Signed in to view transactions on the dashboard.",
    ]) {
      const tags = deriveSkillCapabilityTags({
        slug: "bank-auth-help",
        displayName: "Bank Auth Help",
        frontmatter: {},
        readmeText,
        fileContents: [],
      });

      expect(tags).toEqual([]);
    }
  });

  it("detects inflected transaction signing verbs as financial authority", () => {
    for (const readmeText of [
      "Signs bank transactions after approval.",
      "Signed bank transactions after approval.",
    ]) {
      const tags = deriveSkillCapabilityTags({
        slug: "bank-signing",
        displayName: "Bank Signing",
        frontmatter: {},
        readmeText,
        fileContents: [],
      });

      expect(tags).toEqual([
        "financial-authority",
        "can-sign-transactions",
        "requires-sensitive-credentials",
      ]);
    }
  });

  it("keeps inferred crypto wallet requirements tied to sensitive credentials", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "onchain-approval",
      displayName: "Onchain Approval",
      frontmatter: {},
      readmeText: "Sign and submit on-chain transaction approvals for the user's account.",
      fileContents: [],
    });

    expect(tags).toEqual([
      "crypto",
      "financial-authority",
      "requires-wallet",
      "can-sign-transactions",
      "requires-sensitive-credentials",
    ]);
  });

  it("keeps EIP-712 transaction signing tagged as crypto wallet authority", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "typed-data-signer",
      displayName: "Typed Data Signer",
      frontmatter: {},
      readmeText: "Signs EIP-712 transactions after approval.",
      fileContents: [],
    });

    expect(tags).toEqual([
      "crypto",
      "financial-authority",
      "requires-wallet",
      "can-sign-transactions",
      "requires-sensitive-credentials",
    ]);
  });

  it("keeps hyphenated ERC-20 transaction signing tagged as crypto wallet authority", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "token-helper",
      displayName: "Token Helper",
      frontmatter: {},
      readmeText: "Signs ERC-20 transactions after approval.",
      fileContents: [],
    });

    expect(tags).toEqual([
      "crypto",
      "financial-authority",
      "requires-wallet",
      "can-sign-transactions",
      "requires-sensitive-credentials",
    ]);
  });

  it("keeps walletClient transactions tagged as crypto wallet authority", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "tx-helper",
      displayName: "Transaction Helper",
      frontmatter: {},
      readmeText: "Submit user transactions.",
      fileContents: [
        {
          path: "src/client.ts",
          content: "await walletClient.sendTransaction({ to, value });",
        },
      ],
    });

    expect(tags).toEqual([
      "crypto",
      "financial-authority",
      "requires-wallet",
      "can-sign-transactions",
      "requires-sensitive-credentials",
    ]);
  });

  it("keeps bare sendTransaction calls tagged as crypto wallet authority", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "tx-helper",
      displayName: "Transaction Helper",
      frontmatter: {},
      readmeText: "Submit user transactions.",
      fileContents: [
        {
          path: "src/client.ts",
          content: "await sendTransaction({ to, value });",
        },
      ],
    });

    expect(tags).toEqual([
      "crypto",
      "financial-authority",
      "requires-wallet",
      "can-sign-transactions",
      "requires-sensitive-credentials",
    ]);
  });

  it("treats billing setup helper text as paid-service metadata, not purchase or crypto authority", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "child-dangerous-behavior-recognition-analysis",
      displayName: "Child Hazardous Behavior Recognition Tool",
      summary: "Detects risky child behavior in monitoring videos.",
      frontmatter: {},
      readmeText:
        "Analyze video streams for climbing, fire play, power source contact, and dangerous window behavior.",
      fileContents: [
        {
          path: "skills/smyx_common/scripts/util.py",
          content:
            'HTTP 402: 账户余额不足. 先输入命令 "安装支付技能 smyx-payment", 再输入命令 "技能账户充值".',
        },
      ],
    });

    expect(tags).toContain("requires-paid-service");
    expect(tags).not.toContain("financial-authority");
    expect(tags).not.toContain("can-make-purchases");
    expect(tags).not.toContain("crypto");
  });

  it("treats price-only cost text as paid-service metadata", () => {
    for (const readmeText of [
      "This skill costs $5 per month to use.",
      "Calls cost $0.01 via the provider API.",
      "Users pay for API usage via Stripe.",
      "Pay for provider API calls before use.",
      "The pro plan costs $20/month.",
      "The provider charges $0.01 per call.",
      "Users are charged $5/month.",
      "The API is charged per request.",
      "Payment is required to use this skill.",
      "A paid subscription is required.",
      "Requires a paid plan.",
      "Requires a pro plan.",
      "Requires a premium subscription.",
      "Requires a subscription.",
      "Pricing $4.99 - One-time purchase.",
    ]) {
      const tags = deriveSkillCapabilityTags({
        slug: "paid-helper",
        displayName: "Paid Helper",
        frontmatter: {},
        readmeText,
        fileContents: [],
      });

      expect(tags).toEqual(["requires-paid-service"]);
    }
  });

  it("does not treat one-time purchase action text as paid-service metadata", () => {
    for (const readmeText of [
      "Make a one-time purchase for the user after explicit approval.",
      "Use the saved payment method to make a one-time purchase after approval.",
      "Payment method: saved card. Make a one-time purchase after approval.",
      "Requires payment method: saved card. Make a one-time purchase after approval.",
      "Requires payment method on file before making approved purchases.",
      "Requires payment methods on file before making approved purchases.",
      "Requires payment cards on file before making approved purchases.",
      "Requires payment sources on file before making approved purchases.",
      "Pay with the saved card after approval.",
      "Installation\nMake a one-time purchase after approval.",
    ]) {
      const tags = deriveSkillCapabilityTags({
        slug: "checkout-helper",
        displayName: "Checkout Helper",
        frontmatter: {},
        readmeText,
        fileContents: [],
      });

      expect(tags).toEqual(["financial-authority", "can-make-purchases"]);
    }
  });

  it("does not treat subscription identifiers as paid-service metadata", () => {
    for (const readmeText of [
      "Requires subscription ID to access Azure resources.",
      "Requires a subscription ID to access Azure resources.",
      "Requires subscription IDs to access Azure resources.",
      "Requires subscription identifier to access Azure resources.",
      "Requires a subscription key to access Azure resources.",
      "Requires subscription to GitHub webhook events.",
      "Requires a subscription to GraphQL updates.",
    ]) {
      const tags = deriveSkillCapabilityTags({
        slug: "azure-helper",
        displayName: "Azure Helper",
        frontmatter: {},
        readmeText,
        fileContents: [],
      });

      expect(tags).toEqual([]);
    }
  });

  it("does not treat negated paid-service wording as paid-service metadata", () => {
    for (const readmeText of [
      "Does not require a subscription.",
      "Doesn't require a paid plan.",
      "Does not require payment.",
      "No payment required.",
      "No payments are required.",
      "No additional payment is required.",
      "No extra payment is required.",
      "Does not currently require a subscription.",
      "Never requires payment.",
      "Never requires a subscription.",
      "Never requires a pro plan.",
      "Doesn’t require a pro plan.",
    ]) {
      const tags = deriveSkillCapabilityTags({
        slug: "free-helper",
        displayName: "Free Helper",
        frontmatter: {},
        readmeText,
        fileContents: [],
      });

      expect(tags).toEqual([]);
    }
  });

  it("does not treat ordinary bank balance wording as paid-service metadata", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "bank-balance-alerts",
      displayName: "Bank Balance Alerts",
      frontmatter: {},
      readmeText:
        "Alerts you when a checking account has insufficient account balance before payroll runs.",
      fileContents: [],
    });

    expect(tags).toEqual([]);
  });

  it("does not treat ordinary planning wording as paid-service metadata", () => {
    for (const readmeText of [
      "Requires a plan before implementing the migration.",
      "Requires plan documents and acceptance criteria.",
      "A plumber charges $150-300 for a visit.",
    ]) {
      const tags = deriveSkillCapabilityTags({
        slug: "planning-helper",
        displayName: "Planning Helper",
        frontmatter: {},
        readmeText,
        fileContents: [],
      });

      expect(tags).toEqual([]);
    }
  });

  it("does not treat ordinary account credential wording as paid-service metadata", () => {
    for (const readmeText of [
      "Requires service account credentials to access Google Cloud APIs.",
      "Requires account access to query invoices.",
    ]) {
      const tags = deriveSkillCapabilityTags({
        slug: "account-helper",
        displayName: "Account Helper",
        frontmatter: {},
        readmeText,
        fileContents: [],
      });

      expect(tags).toEqual([]);
    }
  });

  it("still detects payment-error account balance wording as paid-service metadata", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "paid-api-helper",
      displayName: "Paid API Helper",
      frontmatter: {},
      readmeText:
        "HTTP 402: insufficient account balance. Recharge the skill account before retrying.",
      fileContents: [],
    });

    expect(tags).toEqual(["requires-paid-service"]);
  });

  it("does not treat generic API or LLM token purchases as crypto", () => {
    for (const readmeText of [
      "Buy API tokens after approval.",
      "Purchase OpenAI tokens after approval.",
      "Buy model usage tokens for the user's SaaS account after explicit approval.",
    ]) {
      const tags = deriveSkillCapabilityTags({
        slug: "token-buyer",
        displayName: "Token Buyer",
        frontmatter: {},
        readmeText,
        fileContents: [],
      });

      expect(tags).toEqual(["financial-authority", "can-make-purchases"]);
    }
  });

  it("preserves crypto labels for crypto asset purchases", () => {
    for (const readmeText of [
      "Buy NFT after approval.",
      "Buys crypto tokens after approval.",
      "Buying NFTs after approval.",
      "Buy on-chain tokens after approval.",
      "Purchase coins from the marketplace.",
      "Purchased ERC20 tokens from the marketplace.",
      "Purchase cryptocurrency after approval.",
      "Buy cryptocurrencies after approval.",
    ]) {
      const tags = deriveSkillCapabilityTags({
        slug: "asset-buyer",
        displayName: "Asset Buyer",
        frontmatter: {},
        readmeText,
        fileContents: [],
      });

      expect(tags).toEqual(["crypto", "financial-authority", "can-make-purchases"]);
    }
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
          content: "@import url('https://fonts.googleapis.com/css2?family=Inter&display=swap');",
        },
      ],
    });

    expect(tags).toEqual([]);
  });

  it("does not treat generic pay attention wording as a purchase signal", () => {
    const tags = deriveSkillCapabilityTags({
      slug: "alon-fact-check",
      displayName: "Alon Fact Check",
      frontmatter: {},
      readmeText: "Pay attention to dates — a source from 2020 may not be current.",
      fileContents: [],
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
