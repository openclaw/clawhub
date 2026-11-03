import { ConvexError } from "convex/values";

export function assertScannerSource(source: string | undefined) {
  if (source !== undefined && !/^[a-f0-9]{40}$/.test(source)) {
    throw new ConvexError("Scanner source must be a full 40-character lowercase Git revision.");
  }
}
