export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

const OPENAI_EMBEDDING_ENDPOINT = "https://api.openai.com/v1/embeddings";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_OLLAMA_EMBEDDING_MODEL = "qwen3-embedding:4b";
const LOCAL_CONVEX_DEPLOYMENT_PREFIX = "anonymous:";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1_000;

type EmbeddingProvider = "openai" | "ollama" | "none";

class RetryableEmbeddingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RetryableEmbeddingError";
  }
}

function emptyEmbedding() {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
}

function parseRetryAfterMs(retryAfterHeader: string | null) {
  if (!retryAfterHeader) return null;

  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const dateMs = Date.parse(retryAfterHeader);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

function getRetryDelayMs(attempt: number, retryAfterMs: number | null) {
  const exponentialDelayMs = BASE_RETRY_DELAY_MS * 2 ** attempt;
  if (retryAfterMs == null) return exponentialDelayMs;
  return Math.max(exponentialDelayMs, retryAfterMs);
}

function normalizeRetryableNetworkError(error: unknown, providerName: string) {
  if (!(error instanceof Error)) return null;

  if (error.name === "AbortError") {
    return new RetryableEmbeddingError(
      `${providerName} embedding request timed out after ${Math.floor(REQUEST_TIMEOUT_MS / 1000)} seconds`,
      { cause: error },
    );
  }

  if (error instanceof TypeError) {
    return new RetryableEmbeddingError(
      `${providerName} embedding request failed: ${error.message}`,
      {
        cause: error,
      },
    );
  }

  return null;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isLocalConvexDeployment() {
  return process.env.CONVEX_DEPLOYMENT?.trim()
    .toLowerCase()
    .startsWith(LOCAL_CONVEX_DEPLOYMENT_PREFIX);
}

function getEmbeddingProvider(): EmbeddingProvider {
  const configuredProvider = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();

  if (
    configuredProvider === "openai" ||
    configuredProvider === "ollama" ||
    configuredProvider === "none" ||
    configuredProvider === "auto"
  ) {
    if (configuredProvider !== "auto") return configuredProvider;
  }

  if (configuredProvider) {
    console.warn(
      `Unsupported EMBEDDING_PROVIDER "${configuredProvider}"; falling back to automatic embedding provider selection`,
    );
  }

  if (process.env.OPENAI_API_KEY) return "openai";

  if (
    process.env.OLLAMA_EMBEDDING_MODEL ||
    process.env.OLLAMA_EMBEDDING_BASE_URL ||
    process.env.OLLAMA_HOST
  ) {
    return "ollama";
  }

  if (isLocalConvexDeployment()) return "ollama";

  return "none";
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function validateEmbeddingDimensions(embedding: number[], providerName: string) {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `${providerName} embedding returned ${embedding.length} dimensions; expected ${EMBEDDING_DIMENSIONS}. Use an embedding model/configuration that matches the Convex vector index dimensions.`,
    );
  }

  return embedding;
}

function parseOpenAiEmbedding(payload: unknown) {
  const embedding =
    typeof payload === "object" && payload !== null
      ? (payload as { data?: Array<{ embedding?: unknown }> }).data?.[0]?.embedding
      : undefined;

  return isNumberArray(embedding) ? embedding : null;
}

function parseOllamaEmbedding(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return null;

  const { embeddings, embedding } = payload as {
    embeddings?: unknown;
    embedding?: unknown;
  };
  if (Array.isArray(embeddings) && isNumberArray(embeddings[0])) {
    return embeddings[0];
  }
  if (isNumberArray(embedding)) return embedding;

  return null;
}

function getOllamaEmbeddingEndpoint() {
  const baseUrl =
    process.env.OLLAMA_EMBEDDING_BASE_URL?.trim() ||
    process.env.OLLAMA_HOST?.trim() ||
    DEFAULT_OLLAMA_BASE_URL;
  const baseUrlWithScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl)
    ? baseUrl
    : `http://${baseUrl}`;
  const normalizedBaseUrl = baseUrlWithScheme.endsWith("/")
    ? baseUrlWithScheme
    : `${baseUrlWithScheme}/`;

  return new URL("api/embed", normalizedBaseUrl).toString();
}

async function requestEmbedding(options: {
  body: unknown;
  endpoint: string;
  headers?: Record<string, string>;
  parseEmbedding: (payload: unknown) => number[] | null;
  providerName: string;
}) {
  let lastRetryableError: RetryableEmbeddingError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(options.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        body: JSON.stringify(options.body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const message = await response.text();
        const isRetryableStatus = response.status === 429 || response.status >= 500;
        if (isRetryableStatus) {
          const retryableError = new RetryableEmbeddingError(
            `${options.providerName} embedding failed (${response.status}): ${message}`,
          );
          lastRetryableError = retryableError;

          if (attempt < MAX_ATTEMPTS - 1) {
            const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
            const delayMs = getRetryDelayMs(attempt, retryAfterMs);
            console.warn(
              `${options.providerName} embeddings retry in ${delayMs}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
            );
            await sleep(delayMs);
            continue;
          }

          throw retryableError;
        }

        throw new Error(`${options.providerName} embedding failed: ${message}`);
      }

      const payload = await response.json();
      const embedding = options.parseEmbedding(payload);
      if (!embedding) throw new Error(`${options.providerName} embedding missing from response`);
      return validateEmbeddingDimensions(embedding, options.providerName);
    } catch (error) {
      const retryableNetworkError = normalizeRetryableNetworkError(error, options.providerName);
      if (retryableNetworkError) {
        lastRetryableError = retryableNetworkError;
        if (attempt < MAX_ATTEMPTS - 1) {
          const delayMs = getRetryDelayMs(attempt, null);
          console.warn(
            `${options.providerName} embeddings network retry in ${delayMs}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
          );
          await sleep(delayMs);
          continue;
        }
        throw retryableNetworkError;
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastRetryableError ?? new Error(`${options.providerName} embedding failed after retries`);
}

async function generateOpenAiEmbedding(text: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("OPENAI_API_KEY is not configured; using zero embeddings");
    return emptyEmbedding();
  }

  return await requestEmbedding({
    body: {
      model: EMBEDDING_MODEL,
      input: text,
    },
    endpoint: OPENAI_EMBEDDING_ENDPOINT,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    parseEmbedding: parseOpenAiEmbedding,
    providerName: "OpenAI",
  });
}

async function generateOllamaEmbedding(text: string) {
  const model = process.env.OLLAMA_EMBEDDING_MODEL?.trim() || DEFAULT_OLLAMA_EMBEDDING_MODEL;
  const keepAlive = process.env.OLLAMA_EMBEDDING_KEEP_ALIVE?.trim();
  const body: {
    dimensions: number;
    input: string;
    keep_alive?: string;
    model: string;
  } = {
    model,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  };

  if (keepAlive) body.keep_alive = keepAlive;

  return await requestEmbedding({
    body,
    endpoint: getOllamaEmbeddingEndpoint(),
    parseEmbedding: parseOllamaEmbedding,
    providerName: "Ollama",
  });
}

export async function generateEmbedding(text: string) {
  const provider = getEmbeddingProvider();

  if (provider === "openai") return await generateOpenAiEmbedding(text);
  if (provider === "ollama") return await generateOllamaEmbedding(text);

  console.warn("No embedding provider is configured; using zero embeddings");
  return emptyEmbedding();
}
