import dns from "node:dns";
import { request } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

const blockedAddresses = new BlockList();
// Private, local, shared, documentation, transition, and reserved destinations
// from the IANA special-purpose registries, plus multicast.
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blockedAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blockedAddresses.addSubnet(address, prefix, "ipv6");
const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");

function isPublicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, "ipv4");
  // This also excludes IPv4-mapped, NAT64, link-local and unique-local addresses.
  return (
    family === 6 && globalIpv6.check(address, "ipv6") && !blockedAddresses.check(address, "ipv6")
  );
}

const lookupPublicAddress: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, "");
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      return callback(new Error("Image destination is not public"), "");
    }
    // Return the checked addresses directly to the socket. A separate validation
    // lookup followed by ordinary fetch would allow DNS rebinding between them.
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};

export function requestPublicImage(url: URL, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        agent: false,
        lookup: lookupPublicAddress,
        signal,
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*" },
      },
      (response) => {
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined)
              headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          }
          const status = response.statusCode ?? 502;
          const noBody = status === 204 || status === 205 || status === 304;
          if (noBody) response.destroy();
          resolve(
            new Response(noBody ? null : (Readable.toWeb(response) as ReadableStream<Uint8Array>), {
              status,
              headers,
            }),
          );
        } catch (error) {
          response.destroy();
          reject(error);
        }
      },
    );
    req.on("error", reject);
    req.end();
  });
}
