import { expect, it } from "vitest";

it("completes XMLHttpRequest through jsdom's compatible dispatcher", async () => {
  const request = new XMLHttpRequest();
  const completed = new Promise<void>((resolve, reject) => {
    request.addEventListener("load", () => resolve(), { once: true });
    request.addEventListener("error", () => reject(new Error("XHR failed")), { once: true });
  });

  request.open("GET", "data:text/plain,hello");
  request.send();
  await completed;

  expect(request.status).toBe(200);
  expect(request.responseText).toBe("hello");
});
