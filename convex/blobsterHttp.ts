import { z } from "zod";
import { httpAction } from "./functions";
import { json, text } from "./httpApiV1/shared";
import { requireApiTokenUser } from "./lib/apiTokenAuth";
import { generateBlobster } from "./lib/blobsterGeneration";

const requestSchema = z.strictObject({ prompt: z.string().trim().min(1).max(8_000) });
const MAX_REQUEST_BYTES = 32_000;

async function readPrompt(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const result = requestSchema.safeParse(JSON.parse(body));
    return result.success ? result.data.prompt : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export const generateBlobsterHttp = httpAction(async (ctx, request) => {
  try {
    await requireApiTokenUser(ctx, request);
  } catch {
    return text("Sign in to ClawHub to generate a Blobster.", 401);
  }
  const prompt = await readPrompt(request);
  if (!prompt) return text("Provide a description of 1–8,000 characters.", 400);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey)
    return text(
      "Blobster generation is not configured. Contact the instance operator to enable generation.",
      503,
    );
  try {
    // A streamed body can outlive admission. Recheck current authority before paid I/O.
    await requireApiTokenUser(ctx, request);
  } catch {
    return text("Sign in to ClawHub to generate a Blobster.", 401);
  }
  try {
    // Only the explicitly submitted text leaves ClawHub. No workspace or SOUL reads.
    return json(await generateBlobster(prompt, apiKey));
  } catch {
    // Do not expose provider output, credentials, or the creator's description.
    return text("Could not generate a valid Blobster. Try another description.", 502);
  }
});
