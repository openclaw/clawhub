export function hangUntilAborted(_input: unknown, init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    signal.addEventListener(
      "abort",
      () => {
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException("The operation was aborted.", "AbortError"),
        );
      },
      { once: true },
    );
  });
}

export function stallingBody(signal: AbortSignal | null | undefined) {
  return new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    signal.addEventListener(
      "abort",
      () => {
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException("The operation was aborted.", "AbortError"),
        );
      },
      { once: true },
    );
  });
}
