/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS, generateEmbedding } from "./embeddings";

const fetchMock = vi.fn<typeof fetch>();
const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

const originalFetch = globalThis.fetch;
const originalConvexDeployment = process.env.CONVEX_DEPLOYMENT;
const originalApiKey = process.env.OPENAI_API_KEY;
const originalEmbeddingProvider = process.env.EMBEDDING_PROVIDER;
const originalOllamaEmbeddingBaseUrl = process.env.OLLAMA_EMBEDDING_BASE_URL;
const originalOllamaEmbeddingKeepAlive = process.env.OLLAMA_EMBEDDING_KEEP_ALIVE;
const originalOllamaEmbeddingModel = process.env.OLLAMA_EMBEDDING_MODEL;
const originalOllamaHost = process.env.OLLAMA_HOST;

function jsonResponse(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
    ...init,
  });
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function testEmbedding(seed = 0) {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => seed + index / 1000);
}

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as typeof fetch;
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.CONVEX_DEPLOYMENT;
  delete process.env.EMBEDDING_PROVIDER;
  delete process.env.OLLAMA_EMBEDDING_BASE_URL;
  delete process.env.OLLAMA_EMBEDDING_KEEP_ALIVE;
  delete process.env.OLLAMA_EMBEDDING_MODEL;
  delete process.env.OLLAMA_HOST;
  consoleWarnSpy.mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;

  restoreEnv("OPENAI_API_KEY", originalApiKey);
  restoreEnv("CONVEX_DEPLOYMENT", originalConvexDeployment);
  restoreEnv("EMBEDDING_PROVIDER", originalEmbeddingProvider);
  restoreEnv("OLLAMA_EMBEDDING_BASE_URL", originalOllamaEmbeddingBaseUrl);
  restoreEnv("OLLAMA_EMBEDDING_KEEP_ALIVE", originalOllamaEmbeddingKeepAlive);
  restoreEnv("OLLAMA_EMBEDDING_MODEL", originalOllamaEmbeddingModel);
  restoreEnv("OLLAMA_HOST", originalOllamaHost);

  vi.useRealTimers();
});

describe("generateEmbedding", () => {
  it("returns zero embedding when no embedding provider is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await generateEmbedding("hello world");

    expect(result).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(result.every((value) => value === 0)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries on 429 responses and then succeeds", async () => {
    vi.useFakeTimers();
    const embedding = testEmbedding(0.25);
    fetchMock.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ embedding }] }));

    const promise = generateEmbedding("retry me");
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual(embedding);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable 4xx responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad request", { status: 400 }));

    await expect(generateEmbedding("bad")).rejects.toThrow("OpenAI embedding failed: bad request");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on network failures and then succeeds", async () => {
    vi.useFakeTimers();
    const embedding = testEmbedding(1);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ embedding }] }));

    const promise = generateEmbedding("network retry");
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual(embedding);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries timeouts up to max attempts and preserves timeout error", async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new DOMException("aborted", "AbortError"));

    const promise = generateEmbedding("always timeout");
    const rejection = expect(promise).rejects.toThrow(
      "OpenAI embedding request timed out after 10 seconds",
    );
    await vi.runAllTimersAsync();

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses Ollama /api/embed with Convex vector index dimensions when configured", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.EMBEDDING_PROVIDER = "ollama";
    process.env.OLLAMA_EMBEDDING_BASE_URL = "http://ollama.local:11434";
    process.env.OLLAMA_EMBEDDING_KEEP_ALIVE = "10m";
    process.env.OLLAMA_EMBEDDING_MODEL = "qwen3-embedding:4b";
    const embedding = testEmbedding(2);
    fetchMock.mockResolvedValueOnce(jsonResponse({ embeddings: [embedding] }));

    await expect(generateEmbedding("local search")).resolves.toEqual(embedding);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://ollama.local:11434/api/embed",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({
      model: "qwen3-embedding:4b",
      input: "local search",
      dimensions: EMBEDDING_DIMENSIONS,
      keep_alive: "10m",
    });
  });

  it("uses Ollama automatically when only an Ollama model is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.OLLAMA_EMBEDDING_MODEL = "qwen3-embedding:4b";
    const embedding = testEmbedding(3);
    fetchMock.mockResolvedValueOnce(jsonResponse({ embeddings: [embedding] }));

    await expect(generateEmbedding("local fallback")).resolves.toEqual(embedding);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/embed",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses Ollama automatically for local anonymous Convex deployments", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.CONVEX_DEPLOYMENT = "anonymous:anonymous-clawhub";
    const embedding = testEmbedding(4);
    fetchMock.mockResolvedValueOnce(jsonResponse({ embeddings: [embedding] }));

    await expect(generateEmbedding("local deployment")).resolves.toEqual(embedding);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/embed",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(request.body as string)).toMatchObject({
      model: "qwen3-embedding:4b",
      dimensions: EMBEDDING_DIMENSIONS,
    });
  });

  it("does not use Ollama automatically for hosted Convex deployments", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.CONVEX_DEPLOYMENT = "dev:example-dev";

    const result = await generateEmbedding("hosted dev");

    expect(result).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(result.every((value) => value === 0)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts OLLAMA_HOST values without an explicit URL scheme", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.OLLAMA_EMBEDDING_MODEL = "qwen3-embedding:4b";
    process.env.OLLAMA_HOST = "127.0.0.1:11434";
    const embedding = testEmbedding(5);
    fetchMock.mockResolvedValueOnce(jsonResponse({ embeddings: [embedding] }));

    await expect(generateEmbedding("local host")).resolves.toEqual(embedding);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/embed",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects Ollama embeddings that do not match the Convex vector index dimensions", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.EMBEDDING_PROVIDER = "ollama";
    fetchMock.mockResolvedValueOnce(jsonResponse({ embeddings: [[0.25, 0.75]] }));

    await expect(generateEmbedding("wrong dimensions")).rejects.toThrow(
      `Ollama embedding returned 2 dimensions; expected ${EMBEDDING_DIMENSIONS}`,
    );
  });
});
