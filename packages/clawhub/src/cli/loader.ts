import { type createCrabLoader, formatError } from "./ui.js";

export async function withLoaderErrorHandling<T>(
  loader: ReturnType<typeof createCrabLoader> | null,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    loader?.fail(formatError(error));
    throw error;
  }
}
