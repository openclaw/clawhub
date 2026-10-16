import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
// One capability covers all subject and judge calls across both evaluation arms.
const DEFAULT_MAX_REQUESTS = 8_192;
const ALLOWED_PATHS = new Set(["/v1/chat/completions", "/v1/responses", "/v1/responses/compact"]);

function reject(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: { message } }));
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_REQUEST_BYTES) throw new Error("request-too-large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function upstreamHeaders(request: IncomingMessage, apiKey: string) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (
      value === undefined ||
      ["authorization", "connection", "content-length", "host"].includes(name.toLowerCase())
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  headers.set("authorization", `Bearer ${apiKey}`);
  headers.set("content-type", "application/json");
  return headers;
}

function copyResponseHeaders(upstream: Response, response: ServerResponse) {
  for (const [name, value] of upstream.headers) {
    if (["connection", "content-encoding", "content-length", "transfer-encoding"].includes(name)) {
      continue;
    }
    response.setHeader(name, value);
  }
}

export async function startOpenAiCapabilityBroker(args: {
  allowedModels: readonly string[];
  apiKey: string;
  maxRequests?: number;
  upstreamBaseUrl?: string;
}) {
  const allowedModels = new Set(args.allowedModels);
  const capabilityToken = randomBytes(32).toString("base64url");
  const upstreamBaseUrl = (args.upstreamBaseUrl ?? "https://api.openai.com").replace(/\/$/, "");
  const requestLimit = args.maxRequests ?? DEFAULT_MAX_REQUESTS;
  let requestsRemaining = requestLimit;
  let budgetRejections = 0;
  let providerRateLimitResponses = 0;
  const activeRequests = new Set<AbortController>();

  const server = createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== `Bearer ${capabilityToken}`) {
        reject(response, 401, "invalid evaluation capability");
        return;
      }
      const url = new URL(request.url ?? "/", "http://evaluation-broker.invalid");
      if (request.method !== "POST" || !ALLOWED_PATHS.has(url.pathname)) {
        reject(response, 404, "unsupported evaluation endpoint");
        return;
      }
      let body = await readRequestBody(request);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        reject(response, 400, "evaluation request must be JSON");
        return;
      }
      const requestBody =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : undefined;
      const model = requestBody?.model;
      if (typeof model !== "string" || !allowedModels.has(model)) {
        reject(response, 403, "model is outside this evaluation capability");
        return;
      }
      if (
        url.pathname.startsWith("/v1/responses") &&
        requestBody?.background !== undefined &&
        requestBody.background !== false
      ) {
        reject(response, 400, "background evaluation requests are not supported");
        return;
      }

      // SkillEvaluator uses the legacy field for proxy URLs, but this broker
      // forwards to OpenAI, where GPT-5 judges require max_completion_tokens.
      if (
        url.pathname === "/v1/chat/completions" &&
        model.startsWith("gpt-5") &&
        typeof requestBody?.max_tokens === "number" &&
        requestBody.max_completion_tokens === undefined
      ) {
        const { max_tokens, ...payload } = requestBody;
        body = Buffer.from(JSON.stringify({ ...payload, max_completion_tokens: max_tokens }));
      }

      // Reserve after reading/validating the body so concurrent requests cannot
      // all pass an earlier allowance check before any of them decrements it.
      if (requestsRemaining <= 0) {
        budgetRejections += 1;
        reject(response, 429, "evaluation capability exhausted");
        return;
      }
      requestsRemaining -= 1;
      const controller = new AbortController();
      activeRequests.add(controller);
      try {
        const upstream = await fetch(`${upstreamBaseUrl}${url.pathname}${url.search}`, {
          body,
          headers: upstreamHeaders(request, args.apiKey),
          method: "POST",
          signal: controller.signal,
        });
        if (upstream.status === 429) providerRateLimitResponses += 1;
        copyResponseHeaders(upstream, response);
        // The pinned evaluator retries 502 within its judge deadline, but not 520.
        response.writeHead(upstream.status === 520 ? 502 : upstream.status);
        if (!upstream.body) {
          response.end();
          return;
        }
        await pipeline(
          Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]),
          response,
        );
      } finally {
        activeRequests.delete(controller);
      }
    } catch (error) {
      if (!response.headersSent) reject(response, 502, "evaluation provider request failed");
      else response.destroy(error instanceof Error ? error : undefined);
    }
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", rejectPromise);
      resolvePromise();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("evaluation broker did not bind");

  return {
    capabilityToken,
    port: address.port,
    usage() {
      return {
        requestLimit,
        forwardedRequests: requestLimit - requestsRemaining,
        budgetRejections,
        providerRateLimitResponses,
      };
    },
    async close() {
      for (const controller of activeRequests) controller.abort();
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
        server.closeAllConnections();
      });
    },
  };
}
