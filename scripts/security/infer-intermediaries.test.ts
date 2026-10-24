/* @vitest-environment node */
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractResponseText } from "../../convex/lib/openaiResponse";
import { inferIntermediaries } from "./infer-intermediaries";

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// Opt in explicitly: these exercise real model decisions, not mocked responses.
// Fictional providers keep these controls independent of real publishers.
describe.skipIf(process.env.INTERMEDIARY_LIVE_EVAL !== "1")(
  "live intermediary prompt contract",
  () => {
    const cases = [
      {
        name: "Outlook through RelayBridge (fictional provider)",
        expected: true,
        service: "RelayBridge",
        content: `---
name: outlook-api
description: Microsoft Outlook API integration with managed OAuth.
---
# Outlook
Access the Microsoft Outlook API (via Microsoft Graph) with managed OAuth authentication.
## Base URL
https://gateway.relaybridge.example/outlook/{native-api-path}
The gateway proxies requests to graph.microsoft.com and automatically injects your OAuth token.
## Authentication
All requests require the RelayBridge API key in the Authorization header: Bearer $RELAYBRIDGE_API_KEY.
Sign in or create an account at relaybridge.example and copy your API key from relaybridge.example/settings.
Manage your Microsoft OAuth connections at https://ctrl.relaybridge.example.`,
      },
      {
        name: "RelayBridge CLI and raw HTTP are both brokered Outlook routes",
        expected: true,
        service: "RelayBridge",
        content: `# Outlook via RelayBridge
Use relaybridge login, connect Outlook, then run relaybridge outlook message list.
If the local CLI cannot be installed, use raw HTTP to api.relaybridge.example/outlook/v1.0/me
with RELAYBRIDGE_API_KEY. Both modes require a RelayBridge account; no direct route is supported.`,
      },
      {
        name: "advertised Composio platform is not its own additional intermediary",
        expected: false,
        service: "Composio",
        content: `# Composio platform toolkit
Use Composio's multi-app CLI, SDK and tool-routing platform. Manage Composio sessions,
connections and toolkit configuration, and build agents that call supported apps.
Requires Composio login or a Composio API key. The CLI and SDK send requests to
Composio, which brokers connected app access. No additional gateway is used.`,
      },
      {
        name: "broker branding does not exempt an Outlook-only wrapper",
        expected: true,
        service: "Composio",
        content: `---
name: composio
author: Composio
description: Read and send Outlook email only.
---
# Composio Outlook
Requires a Composio account and an Outlook connection. All Outlook calls go through
Composio's hosted connector. There is no direct Outlook route, SDK development,
platform administration, or multi-app toolkit in this skill.`,
      },
      {
        name: "an additional broker behind an advertised platform still counts",
        expected: true,
        service: "RelayCloud",
        content: `# Composio platform toolkit
Develop multi-app agents and manage Composio sessions using the Composio SDK.
This distribution requires RelayCloud login and routes every Composio request through
the hosted RelayCloud credential proxy. Direct Composio requests are unsupported.`,
      },
      {
        name: "Microsoft OAuth and Graph are first-party infrastructure",
        expected: false,
        service: "Microsoft",
        content: `# Outlook direct client
Register your own Microsoft Entra app. Authenticate directly at login.microsoftonline.com
and send requests directly to graph.microsoft.com. No third-party gateway, hosted
connector, or additional platform account is used.`,
      },
      {
        name: "supported self-hosting makes a hosted route optional",
        expected: false,
        service: "CRM",
        content: `# CRM sync
The bundled local client syncs directly with the CRM API using the user's CRM OAuth app.
Run this client on your own machine without any other service, or optionally run the
same client in hosted n8n Cloud. Both paths are supported; n8n Cloud is not required.`,
      },
      {
        name: "opaque remote implementation remains unknown",
        expected: null,
        service: null,
        content: `# Outlook connector
Download and run the connector from downloads.example.com. Its source, authentication,
request routing and account requirements are not included or documented.`,
      },
    ];

    it.each(cases)(
      "$name",
      async ({ content, expected, service }) => {
        expect(Boolean(process.env.OPENAI_API_KEY), "Live evaluation requires OPENAI_API_KEY").toBe(
          true,
        );
        const dir = await artifact({ "SKILL.md": content });
        let httpStatus: number | undefined;
        let modelAnswer: unknown;
        const result = await inferIntermediaries(dir, {
          fetch: async (input, init) => {
            const response = await globalThis.fetch(input, init);
            httpStatus = response.status;
            const payload = await response.clone().json();
            const text = extractResponseText(payload);
            modelAnswer = text ? JSON.parse(text) : undefined;
            return response;
          },
        });
        // A transport/parsing failure must not count as a correct Unknown answer.
        expect(httpStatus).toBe(200);
        expect(modelAnswer).toMatchObject({ requiresIntermediary: expected });
        expect(result.requiresIntermediary).toBe(expected);
        if (service)
          expect(result.intermediaryDetails?.toLowerCase()).toContain(service.toLowerCase());
      },
      70_000,
    );
  },
);

async function artifact(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "clawhub-intermediaries-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

function response(result: unknown) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        output: [
          { type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] },
        ],
      }),
    ),
  );
}

describe("artifact intermediary extraction", () => {
  it("reads supporting code and validates evidence for a required free bridge", async () => {
    const dir = await artifact({
      "SKILL.md": "Access Gmail using the bundled client.",
      "scripts/client.py": 'endpoint = "https://bridge.example/gmail" # Bridge account required',
    });
    const fetch = response({
      requiresIntermediary: true,
      intermediaryDetails: "Requires a Bridge account for Gmail access.",
      evidence: ["e1"],
    });
    const result = await inferIntermediaries(dir, { apiKey: "fixture", fetch });
    expect(result).toMatchObject({
      requiresIntermediary: true,
      intermediaryDetails: "Requires a Bridge account for Gmail access.",
      evidence: [
        { path: "scripts/client.py", snippet: expect.stringContaining("Bridge account required") },
      ],
    });
    const request = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(request.input).toContain("scripts/client.py");
    expect(request.instructions).toContain("Free intermediaries count too");
    expect(request.store).toBe(false);
  });

  it("retains a supported direct route and explains the optional intermediary", async () => {
    const dir = await artifact({
      "SKILL.md": "Use Gmail directly with OAuth, or optionally use Bridge.",
    });
    const result = await inferIntermediaries(dir, {
      apiKey: "fixture",
      fetch: response({
        requiresIntermediary: false,
        intermediaryDetails: "Direct Gmail OAuth is supported; Bridge is optional.",
        evidence: ["e0"],
      }),
    });
    expect(result.requiresIntermediary).toBe(false);
    expect(result.intermediaryDetails).toContain("optional");
  });

  it.each(["opaque.wasm", "large.js", "linked.ts"])(
    "does not infer absence from incomplete inspection (%s)",
    async (path) => {
      const dir = await artifact({ "SKILL.md": "Local formatting tool." });
      if (path === "linked.ts") await symlink("/etc/hosts", join(dir, path));
      else await writeFile(join(dir, path), "x".repeat(path === "large.js" ? 70_000 : 10));
      const result = await inferIntermediaries(dir, {
        apiKey: "fixture",
        fetch: response({
          requiresIntermediary: false,
          intermediaryDetails: "No external service.",
          evidence: ["e0"],
        }),
      });
      expect(result.requiresIntermediary).toBeNull();
    },
  );

  it.each(["e9999", { path: "SKILL.md", snippet: "Sign up for Bridge" }])(
    "rejects invented or model-authored evidence (%j)",
    async (reference) => {
      const dir = await artifact({ "SKILL.md": "Access Gmail." });
      const result = await inferIntermediaries(dir, {
        apiKey: "fixture",
        fetch: response({
          requiresIntermediary: true,
          intermediaryDetails: "Requires Bridge.",
          evidence: [reference],
        }),
      });
      expect(result.requiresIntermediary).toBeNull();
    },
  );

  it("derives bounded exact quotes from refs without splitting Unicode characters", async () => {
    const content = "x".repeat(399) + "😀 local formatter";
    const dir = await artifact({ "SKILL.md": content });
    const fetch = response({
      requiresIntermediary: false,
      intermediaryDetails: "Local formatter.",
      evidence: ["e1"],
    });
    const result = await inferIntermediaries(dir, { apiKey: "fixture", fetch });
    expect(result.evidence).toEqual([{ path: "SKILL.md", snippet: "😀 local formatter" }]);
    const input = JSON.parse(JSON.parse(String(fetch.mock.calls[0][1]?.body)).input);
    expect(input.files[0].excerpts.map((excerpt: { text: string }) => excerpt.text).join("")).toBe(
      content,
    );
    expect(
      input.files[0].excerpts.every((excerpt: { text: string }) => excerpt.text.length <= 400),
    ).toBe(true);
  });

  it("keeps model failures unknown without throwing into the security lifecycle", async () => {
    const dir = await artifact({ "SKILL.md": "Access Gmail." });
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("timeout"));
    await expect(inferIntermediaries(dir, { apiKey: "fixture", fetch })).resolves.toMatchObject({
      requiresIntermediary: null,
      intermediaryDetails: null,
    });
  });
});
