/* @vitest-environment node */

import { createServer, type Server } from "node:http";
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
});
