import { afterEach, expect, it, vi } from "vitest";
import { classifySearchIntent } from "./searchIntentClassifier";

afterEach(() => vi.unstubAllGlobals());

it("classifies only threshold-qualified aggregate gaps through a strict identity-free provider request", async () => {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: string, options: RequestInit) => {
    requests.push(JSON.parse(String(options.body)));
    return Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                rows: [
                  {
                    query: "notion",
                    intentKind: "company_product",
                    companyProductName: "Notion",
                    confidence: 0.95,
                  },
                ],
              }),
            },
          ],
        },
      ],
    });
  });
  const result = await classifySearchIntent(
    [
      {
        query: "notion",
        searches: 12,
        officialGaps: 8,
        topResults: [
          { name: "notion-community", displayName: "Notion connector", summary: "Read pages" },
        ],
      },
      { query: "rare", searches: 2, officialGaps: 2, topResults: [] },
    ],
    "fixture-provider-key",
  );
  expect(result).toMatchObject({
    status: "available",
    rows: [{ query: "notion", intentKind: "company_product", confidence: 0.95 }],
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    store: false,
    text: { format: { type: "json_schema", strict: true } },
  });
  expect(JSON.parse(String(requests[0].input))).toEqual([
    {
      query: "notion",
      searches: 12,
      officialGaps: 8,
      topResults: [
        { name: "notion-community", displayName: "Notion connector", summary: "Read pages" },
      ],
    },
  ]);
});

it.each(
  [
    [{ query: "other", intentKind: "company_product", companyProductName: "Other", confidence: 1 }],
    [],
    [{ query: "notion", intentKind: "official", companyProductName: "Notion", confidence: 1 }],
    [
      {
        query: "notion",
        intentKind: "company_product",
        companyProductName: "Notion",
        confidence: 2,
      },
    ],
  ].map((rows) => [rows]),
)("never accepts missing, invented, malformed or provenance classifications: %j", async (rows) => {
  vi.stubGlobal("fetch", async () =>
    Response.json({
      status: "completed",
      output: [
        { type: "message", content: [{ type: "output_text", text: JSON.stringify({ rows }) }] },
      ],
    }),
  );
  expect(
    await classifySearchIntent(
      [{ query: "notion", searches: 3, officialGaps: 3, topResults: [] }],
      "fixture-provider-key",
    ),
  ).toMatchObject({ status: "unavailable", rows: [] });
});

it("rejects oversized aggregate inputs before provider egress", async () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  const result = await classifySearchIntent(
    [{ query: "x".repeat(257), searches: 3, officialGaps: 3, topResults: [] }],
    "fixture-provider-key",
  );
  expect(result).toMatchObject({ status: "unavailable", failureCode: "invalid_aggregate_input" });
  expect(request).not.toHaveBeenCalled();
});

it.each(["incomplete", "failed", "cancelled"])(
  "rejects a %s provider response even with parseable output",
  async (status) => {
    vi.stubGlobal("fetch", async () =>
      Response.json({
        status,
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  rows: [
                    {
                      query: "notion",
                      intentKind: "company_product",
                      companyProductName: "Notion",
                      confidence: 0.95,
                    },
                  ],
                }),
              },
            ],
          },
        ],
      }),
    );
    expect(
      await classifySearchIntent(
        [{ query: "notion", searches: 3, officialGaps: 3, topResults: [] }],
        "fixture-provider-key",
      ),
    ).toMatchObject({ status: "unavailable", rows: [] });
  },
);

it("fails closed without exposing provider errors", async () => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("sensitive provider body");
  });
  const result = await classifySearchIntent(
    [{ query: "notion", searches: 3, officialGaps: 3, topResults: [] }],
    "fixture-provider-key",
  );
  expect(result).toMatchObject({
    status: "unavailable",
    rows: [],
    failureCode: "provider_failure",
  });
  expect(JSON.stringify(result)).not.toContain("sensitive");
});
