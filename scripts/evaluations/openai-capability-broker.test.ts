/* @vitest-environment node */

import { createServer, request as httpRequest, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startOpenAiCapabilityBroker } from "./openai-capability-broker";

const servers: Server[] = [];
const brokers: Array<{ close(): Promise<void> }> = [];

async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectPromise);
      resolvePromise();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(brokers.splice(0).map((broker) => broker.close()));
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolvePromise, rejectPromise) =>
            server.close((error) => (error ? rejectPromise(error) : resolvePromise())),
          ),
      ),
  );
});

describe("OpenAI evaluation capability broker", () => {
  it.each(["gpt-5.4", "gpt-6-luna", "gpt-6.1-sol"])(
    "normalizes the proxied %s judge token limit",
    async (model) => {
      const upstreamBaseUrl = await listen(
        createServer(async (request, response) => {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          response.writeHead("max_tokens" in payload ? 400 : 200, {
            "content-type": "application/json",
          });
          response.end(JSON.stringify(payload));
        }),
      );
      const broker = await startOpenAiCapabilityBroker({
        allowedModels: [model],
        apiKey: "long-lived-provider-key",
        upstreamBaseUrl,
      });
      brokers.push(broker);
      const payload = {
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: "Grade this result" }],
        stream: false,
      };
      const response = await fetch(`http://127.0.0.1:${broker.port}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${broker.capabilityToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      expect(response.status).toBe(200);
      const { max_tokens, ...rest } = payload;
      expect(await response.json()).toEqual({ ...rest, max_completion_tokens: max_tokens });
    },
  );

  it.each([
    { endpoint: "/v1/chat/completions", payload: { model: "gpt-4.1", max_tokens: 4096 } },
    {
      endpoint: "/v1/chat/completions",
      payload: { model: "gpt-5.4", max_completion_tokens: 8192 },
    },
    { endpoint: "/v1/responses", payload: { model: "gpt-5.4", max_output_tokens: 8192 } },
  ])("preserves other token limit contracts: $endpoint $payload", async ({ endpoint, payload }) => {
    const upstreamBaseUrl = await listen(
      createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(Buffer.concat(chunks));
      }),
    );
    const broker = await startOpenAiCapabilityBroker({
      allowedModels: [payload.model],
      apiKey: "long-lived-provider-key",
      upstreamBaseUrl,
    });
    brokers.push(broker);
    const response = await fetch(`http://127.0.0.1:${broker.port}${endpoint}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${broker.capabilityToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
  });

  it.each([
    {
      endpoint: "/v1/responses",
      input: {
        reasoning: { effort: "high", summary: "auto" },
        tools: [{ type: "function", name: "greet" }],
      },
      expected: {
        reasoning: { effort: "medium", summary: "auto" },
        tools: [{ type: "function", name: "greet" }],
      },
    },
    {
      endpoint: "/v1/chat/completions",
      input: { temperature: 0, top_p: 1, max_tokens: 4096, max_completion_tokens: 8192 },
      expected: { reasoning_effort: "high", max_completion_tokens: 8192 },
    },
    {
      endpoint: "/v1/responses",
      input: { service_tier: "flex" },
      expected: { reasoning: { effort: "medium" }, service_tier: "flex" },
    },
  ])("applies the versioned role recipe at $endpoint", async ({ endpoint, input, expected }) => {
    const upstreamBaseUrl = await listen(
      createServer(async (request, response) => {
        expect(request.url).toBe(endpoint);
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(Buffer.concat(chunks));
      }),
    );
    const broker = await startOpenAiCapabilityBroker({
      allowedModels: ["gpt-6.1-sol"],
      apiKey: "host-key",
      upstreamBaseUrl,
      reasoningEffort: { responses: "medium", chat: "high" },
      serviceTier: "default",
    });
    brokers.push(broker);
    const response = await fetch("http://127.0.0.1:" + broker.port + endpoint, {
      method: "POST",
      headers: { authorization: "Bearer " + broker.capabilityToken },
      body: JSON.stringify({ model: "gpt-6.1-sol", ...input }),
    });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ model: "gpt-6.1-sol", service_tier: "default", ...expected });
    expect(payload).not.toHaveProperty("max_tokens");
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("top_p");
  });

  it.each(["tools", "functions"])(
    "rejects Sol Chat %s rather than downgrading its tool API",
    async (field) => {
      const broker = await startOpenAiCapabilityBroker({
        allowedModels: ["gpt-6.1-sol"],
        apiKey: "host-key",
      });
      brokers.push(broker);
      const response = await fetch("http://127.0.0.1:" + broker.port + "/v1/chat/completions", {
        method: "POST",
        headers: { authorization: "Bearer " + broker.capabilityToken },
        body: JSON.stringify({ model: "gpt-6.1-sol", [field]: [{ name: "greet" }] }),
      });
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("Responses API");
      expect(broker.usage().forwardedRequests).toBe(0);
    },
  );

  it("keeps the provider key in the broker and forwards an allowed model", async () => {
    let upstreamAuthorization: string | undefined;
    const upstreamBaseUrl = await listen(
      createServer((request, response) => {
        upstreamAuthorization = request.headers.authorization;
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"ok":true}');
      }),
    );
    const broker = await startOpenAiCapabilityBroker({
      allowedModels: ["gpt-subject", "gpt-judge"],
      apiKey: "long-lived-provider-key",
      upstreamBaseUrl,
    });
    brokers.push(broker);

    const response = await fetch(`http://127.0.0.1:${broker.port}/v1/responses`, {
      body: JSON.stringify({ model: "gpt-subject", input: "hello" }),
      headers: {
        authorization: `Bearer ${broker.capabilityToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(upstreamAuthorization).toBe("Bearer long-lived-provider-key");
    expect(broker.capabilityToken).not.toContain("long-lived-provider-key");
  });

  it("rejects credentials, endpoints, and models outside the capability", async () => {
    let upstreamRequests = 0;
    const upstreamBaseUrl = await listen(
      createServer((_request, response) => {
        upstreamRequests += 1;
        response.end("unexpected");
      }),
    );
    const broker = await startOpenAiCapabilityBroker({
      allowedModels: ["gpt-subject"],
      apiKey: "long-lived-provider-key",
      upstreamBaseUrl,
    });
    brokers.push(broker);
    const baseUrl = `http://127.0.0.1:${broker.port}`;

    const invalidToken = await fetch(`${baseUrl}/v1/responses`, {
      body: JSON.stringify({ model: "gpt-subject" }),
      headers: { authorization: "Bearer wrong", "content-type": "application/json" },
      method: "POST",
    });
    const invalidEndpoint = await fetch(`${baseUrl}/v1/files`, {
      body: JSON.stringify({ model: "gpt-subject" }),
      headers: {
        authorization: `Bearer ${broker.capabilityToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    const invalidModel = await fetch(`${baseUrl}/v1/responses`, {
      body: JSON.stringify({ model: "gpt-unscoped" }),
      headers: {
        authorization: `Bearer ${broker.capabilityToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(invalidToken.status).toBe(401);
    expect(invalidEndpoint.status).toBe(404);
    expect(invalidModel.status).toBe(403);
    expect(upstreamRequests).toBe(0);
  });

  it("expires after its bounded request allowance", async () => {
    const upstreamBaseUrl = await listen(
      createServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      }),
    );
    const broker = await startOpenAiCapabilityBroker({
      allowedModels: ["gpt-subject"],
      apiKey: "long-lived-provider-key",
      maxRequests: 1,
      upstreamBaseUrl,
    });
    brokers.push(broker);
    const request = () =>
      fetch(`http://127.0.0.1:${broker.port}/v1/responses`, {
        body: JSON.stringify({ model: "gpt-subject" }),
        headers: {
          authorization: `Bearer ${broker.capabilityToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });

    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(429);
  });

  it("supports a complete paired workload beyond 1,024 requests and reports usage", async () => {
    let forwarded = 0;
    const upstreamBaseUrl = await listen(
      createServer((_request, response) => {
        forwarded += 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      }),
    );
    const broker = await startOpenAiCapabilityBroker({
      allowedModels: ["gpt-subject"],
      apiKey: "host-key",
      upstreamBaseUrl,
    });
    brokers.push(broker);
    for (let attempt = 0; attempt < 1_025; attempt += 1) {
      const response = await fetch(`http://127.0.0.1:${broker.port}/v1/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${broker.capabilityToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "gpt-subject" }),
      });
      await response.text();
      expect(response.status).toBe(200);
    }
    expect(forwarded).toBe(1_025);
    expect(broker.usage()).toEqual({
      requestLimit: 8_192,
      forwardedRequests: 1_025,
      budgetRejections: 0,
      providerRateLimitResponses: 0,
    });
  }, 20_000);

  it("distinguishes provider rate limits from the local capability budget", async () => {
    const upstreamBaseUrl = await listen(
      createServer((_request, response) => {
        response.writeHead(429, { "content-type": "application/json" });
        response.end("{}");
      }),
    );
    const broker = await startOpenAiCapabilityBroker({
      allowedModels: ["gpt-subject"],
      apiKey: "host-key",
      maxRequests: 1,
      upstreamBaseUrl,
    });
    brokers.push(broker);
    const request = () =>
      fetch(`http://127.0.0.1:${broker.port}/v1/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${broker.capabilityToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "gpt-subject" }),
      });
    expect((await request()).status).toBe(429);
    expect((await request()).status).toBe(429);
    expect(broker.usage()).toEqual({
      requestLimit: 1,
      forwardedRequests: 1,
      budgetRejections: 1,
      providerRateLimitResponses: 1,
    });
    const snapshot = broker.usage();
    snapshot.budgetRejections = 0;
    expect(broker.usage().budgetRejections).toBe(1);
  });

  it("reserves the last request only once when streamed bodies finish together", async () => {
    let forwarded = 0;
    const upstreamBaseUrl = await listen(
      createServer((_request, response) => {
        forwarded += 1;
        response.end("{}");
      }),
    );
    const broker = await startOpenAiCapabilityBroker({
      allowedModels: ["gpt-subject"],
      apiKey: "host-key",
      maxRequests: 1,
      upstreamBaseUrl,
    });
    brokers.push(broker);
    const pending = Array.from({ length: 2 }, () => {
      let finish!: () => void;
      const status = new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(
          `http://127.0.0.1:${broker.port}/v1/responses`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${broker.capabilityToken}`,
              "content-type": "application/json",
              "content-length": Buffer.byteLength('{"model":"gpt-subject"}'),
            },
          },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode));
          },
        );
        request.on("error", reject);
        request.write('{"model":');
        finish = () => request.end('"gpt-subject"}');
      });
      return { finish, status };
    });
    // Keep both authenticated requests open before either JSON body completes.
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const request of pending) request.finish();
    expect((await Promise.all(pending.map((request) => request.status))).sort()).toEqual([
      200, 429,
    ]);
    expect(forwarded).toBe(1);
  });

  it("rejects background Responses work without calling the provider", async () => {
    let upstreamRequests = 0;
    const upstreamBaseUrl = await listen(
      createServer((_request, response) => {
        upstreamRequests += 1;
        response.end("unexpected");
      }),
    );
    const broker = await startOpenAiCapabilityBroker({
      allowedModels: ["gpt-subject"],
      apiKey: "long-lived-provider-key",
      upstreamBaseUrl,
    });
    brokers.push(broker);

    const response = await fetch(`http://127.0.0.1:${broker.port}/v1/responses`, {
      body: JSON.stringify({ background: true, model: "gpt-subject" }),
      headers: {
        authorization: `Bearer ${broker.capabilityToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(upstreamRequests).toBe(0);
  });

  it.each([520, 502, 429, 401, 200])(
    "normalizes only upstream 520 for bounded evaluator retries (status %i)",
    async (upstreamStatus) => {
      let upstreamRequests = 0;
      const body = `provider response: ${upstreamStatus}`;
      const upstreamBaseUrl = await listen(
        createServer((_request, response) => {
          upstreamRequests += 1;
          response.writeHead(upstreamStatus, {
            "content-type": "text/plain",
            "retry-after": "2",
            "x-request-id": "provider-request",
          });
          response.end(body);
        }),
      );
      const broker = await startOpenAiCapabilityBroker({
        allowedModels: ["gpt-judge"],
        apiKey: "long-lived-provider-key",
        maxRequests: 1,
        upstreamBaseUrl,
      });
      brokers.push(broker);
      const request = () =>
        fetch(`http://127.0.0.1:${broker.port}/v1/chat/completions`, {
          body: JSON.stringify({ model: "gpt-judge" }),
          headers: {
            authorization: `Bearer ${broker.capabilityToken}`,
            "content-type": "application/json",
          },
          method: "POST",
        });

      const response = await request();
      expect(response.status).toBe(upstreamStatus === 520 ? 502 : upstreamStatus);
      expect(await response.text()).toBe(body);
      expect(response.headers.get("retry-after")).toBe("2");
      expect(response.headers.get("x-request-id")).toBe("provider-request");
      expect((await request()).status).toBe(429);
      expect(upstreamRequests).toBe(1);
    },
  );
});
