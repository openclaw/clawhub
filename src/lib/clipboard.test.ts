import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deferred } from "../__tests__/helpers/deferred";
import { copyText } from "./clipboard";

const originalExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand");

beforeEach(() => {
  vi.stubGlobal("navigator", { clipboard: undefined });
  Object.defineProperty(document, "execCommand", { configurable: true, value: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalExecCommand) Object.defineProperty(document, "execCommand", originalExecCommand);
  else Reflect.deleteProperty(document, "execCommand");
});

it("waits for the clipboard write before reporting success", async () => {
  const pending = deferred();
  const writeText = vi.fn(() => pending.promise);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  let settled = false;
  const copied = copyText("Install the sample skill").then((result) => {
    settled = true;
    return result;
  });

  expect(writeText).toHaveBeenCalledWith("Install the sample skill");
  await Promise.resolve();
  expect(settled).toBe(false);
  pending.resolve();
  await expect(copied).resolves.toBe(true);
});

it("preserves a rejected clipboard write without trying the legacy fallback", async () => {
  const error = new Error("Clipboard denied");
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(error) } });
  const execCommand = vi.fn();
  Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });

  await expect(copyText("sample")).rejects.toBe(error);
  expect(execCommand).not.toHaveBeenCalled();
  expect(document.querySelector("textarea")).toBeNull();
});

it("reports unavailable copying without adding a textarea", async () => {
  await expect(copyText("sample")).resolves.toBe(false);
  expect(document.querySelector("textarea")).toBeNull();
});

it.each([true, false])(
  "returns the legacy copy result %s and removes its selected text",
  async (result) => {
    const text = "first line\nsecond line 🦊";
    const execCommand = vi.fn(() => {
      const textarea = document.querySelector("textarea");
      expect(textarea?.value).toBe(text);
      expect(textarea?.readOnly).toBe(true);
      expect(textarea?.selectionStart).toBe(0);
      expect(textarea?.selectionEnd).toBe(text.length);
      return result;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });

    await expect(copyText(text)).resolves.toBe(result);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  },
);

it("removes the legacy textarea and preserves a thrown copy error", async () => {
  const error = new Error("Legacy copy failed");
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: () => {
      expect(document.querySelector("textarea")?.value).toBe("sample");
      throw error;
    },
  });

  await expect(copyText("sample")).rejects.toBe(error);
  expect(document.querySelector("textarea")).toBeNull();
});
