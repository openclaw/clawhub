// Match fetchImageDataUrl: public OG cards must not wait forever on a hung origin.
export const OG_FETCH_TIMEOUT_MS = 1_500;

export async function withOgFetchTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs = OG_FETCH_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const aborted = new Promise<never>((_, reject) => {
    const rejectOnAbort = () => {
      reject(
        controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new DOMException("The operation was aborted.", "AbortError"),
      );
    };
    if (controller.signal.aborted) {
      rejectOnAbort();
      return;
    }
    controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
  });
  // Mark handled so abort cannot become an unhandled rejection if work() ignores the signal.
  void aborted.catch(() => undefined);
  try {
    return await Promise.race([work(controller.signal), aborted]);
  } finally {
    clearTimeout(timeout);
  }
}
