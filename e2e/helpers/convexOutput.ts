export function extractLastJsonObject(output: string, source = "convex run output") {
  const trimmed = output.trim();
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== "{") continue;
    const candidate = trimmed.slice(index);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Convex can print status lines before the JSON payload.
    }
  }
  throw new Error(`No JSON object in ${source}:\n${output}`);
}

export function parseLastJsonObject<T = unknown>(output: string, source?: string): T {
  return JSON.parse(extractLastJsonObject(output, source)) as T;
}
