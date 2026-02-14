export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIMENSIONS = 1536

const EMBEDDING_ENDPOINT = 'https://api.openai.com/v1/embeddings'
const REQUEST_TIMEOUT_MS = 10_000
const MAX_ATTEMPTS = 3
const BASE_RETRY_DELAY_MS = 1_000

class RetryableEmbeddingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'RetryableEmbeddingError'
  }
}

function emptyEmbedding() {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0)
}

function parseRetryAfterMs(retryAfterHeader: string | null) {
  if (!retryAfterHeader) return null

  const seconds = Number(retryAfterHeader)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000)
  }

  const dateMs = Date.parse(retryAfterHeader)
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now())
  }

  return null
}

function getRetryDelayMs(attempt: number, retryAfterMs: number | null) {
  const exponentialDelayMs = BASE_RETRY_DELAY_MS * 2 ** attempt
  if (retryAfterMs == null) return exponentialDelayMs
  return Math.max(exponentialDelayMs, retryAfterMs)
}

function normalizeRetryableNetworkError(error: unknown) {
  if (!(error instanceof Error)) return null

  if (error.name === 'AbortError') {
    return new RetryableEmbeddingError(
      `OpenAI API request timed out after ${Math.floor(REQUEST_TIMEOUT_MS / 1000)} seconds`,
      { cause: error },
    )
  }

  if (error instanceof TypeError) {
    return new RetryableEmbeddingError(`Embedding request failed: ${error.message}`, { cause: error })
  }

  return null
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function generateEmbedding(text: string) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn('OPENAI_API_KEY is not configured; using zero embeddings')
    return emptyEmbedding()
  }

  let lastRetryableError: RetryableEmbeddingError | null = null

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(EMBEDDING_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: text,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const message = await response.text()
        const isRetryableStatus = response.status === 429 || response.status >= 500
        if (isRetryableStatus) {
          const retryableError = new RetryableEmbeddingError(
            `Embedding failed (${response.status}): ${message}`,
          )
          lastRetryableError = retryableError

          if (attempt < MAX_ATTEMPTS - 1) {
            const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
            const delayMs = getRetryDelayMs(attempt, retryAfterMs)
            console.warn(
              `OpenAI embeddings retry in ${delayMs}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
            )
            await sleep(delayMs)
            continue
          }

          throw retryableError
        }

        throw new Error(`Embedding failed: ${message}`)
      }

      const payload = (await response.json()) as {
        data?: Array<{ embedding: number[] }>
      }
      const embedding = payload.data?.[0]?.embedding
      if (!embedding) throw new Error('Embedding missing from response')
      return embedding
    } catch (error) {
      const retryableNetworkError = normalizeRetryableNetworkError(error)
      if (retryableNetworkError) {
        lastRetryableError = retryableNetworkError
        if (attempt < MAX_ATTEMPTS - 1) {
          const delayMs = getRetryDelayMs(attempt, null)
          console.warn(
            `OpenAI embeddings network retry in ${delayMs}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
          )
          await sleep(delayMs)
          continue
        }
        throw retryableNetworkError
      }

      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  throw lastRetryableError ?? new Error('Embedding failed after retries')
}
