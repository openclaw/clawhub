/* @vitest-environment node */
import dns from "node:dns";
import { createServer, type AddressInfo, type LookupFunction } from "node:net";
import { expect, it, vi } from "vitest";
import { fetchPublisherProfileImageDataUrl } from "./fetchImageDataUrl";

it.each([
  [{ address: "127.0.0.1", family: 4 }],
  [{ address: "::ffff:127.0.0.1", family: 6 }],
  [
    { address: "127.0.0.1", family: 4 },
    { address: "8.8.8.8", family: 4 },
  ],
])("rejects private or mixed DNS results before connecting: %j", async (...addresses) => {
  let connections = 0;
  const server = createServer((socket) => {
    connections++;
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const resolver: LookupFunction = (_host, options, callback) => {
    callback(null, options.all ? addresses : addresses[0].address, addresses[0].family);
  };
  const lookup = vi.spyOn(dns, "lookup").mockImplementation(resolver as typeof dns.lookup);
  try {
    await expect(
      fetchPublisherProfileImageDataUrl(`https://public-image.example:${port}/image.png`),
    ).resolves.toBeNull();
    expect(connections).toBe(0);
  } finally {
    lookup.mockRestore();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
