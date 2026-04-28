import { buildCliAuthUrl, startLoopbackAuthServer } from "../../browserAuth.js";
import { readGlobalConfig, writeGlobalConfig } from "../../config.js";
import { pollForDeviceToken, requestDeviceCode } from "../../deviceAuth.js";
import { discoverRegistryFromSite } from "../../discovery.js";
import { apiRequest } from "../../http.js";
import { ApiRoutes, ApiV1WhoamiResponseSchema } from "../../schema/index.js";
import { requireAuthToken } from "../authToken.js";
import { getRegistry } from "../registry.js";
import type { GlobalOpts } from "../types.js";
import { createSpinner, fail, formatError, openInBrowser, promptHidden } from "../ui.js";

export async function cmdLoginFlow(
  opts: GlobalOpts,
  options: { token?: string; label?: string; browser?: boolean; device?: boolean },
  inputAllowed: boolean,
) {
  if (options.token) {
    await cmdLogin(opts, options.token, inputAllowed);
    return;
  }

  if (options.device) {
    await cmdDeviceLogin(opts);
    return;
  }

  if (options.browser === false) {
    fail("Token required (use --token, --device, or remove --no-browser)");
  }

  const label = (options.label ?? "CLI token").trim() || "CLI token";
  const receiver = await startLoopbackAuthServer();
  const discovery = await discoverRegistryFromSite(opts.site).catch(() => null);
  const authBase = discovery?.authBase?.trim() || opts.site;
  const authUrl = buildCliAuthUrl({
    siteUrl: authBase,
    redirectUri: receiver.redirectUri,
    label,
    state: receiver.state,
  });

  console.log(`Opening browser: ${authUrl}`);
  openInBrowser(authUrl);

  const result = await receiver.waitForResult();
  const registry = result.registry?.trim() || opts.registry;
  const registrySource = result.registry?.trim() ? "cli" : opts.registrySource;
  await cmdLogin({ ...opts, registry, registrySource }, result.token, inputAllowed);
}

export async function cmdLogin(
  opts: GlobalOpts,
  tokenFlag: string | undefined,
  inputAllowed: boolean,
) {
  if (!tokenFlag && !inputAllowed) fail("Token required (use --token or remove --no-input)");

  const token = tokenFlag || (await promptHidden("ClawHub token: "));
  if (!token) fail("Token required");

  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner("Verifying token");
  try {
    const whoami = await apiRequest(
      registry,
      { method: "GET", path: ApiRoutes.whoami, token },
      ApiV1WhoamiResponseSchema,
    );
    if (!whoami.user) fail("Login failed");

    await writeGlobalConfig({ registry, token });
    const handle = whoami.user.handle ? `@${whoami.user.handle}` : "unknown user";
    spinner.succeed(`OK. Logged in as ${handle}.`);
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdLogout(opts: GlobalOpts) {
  const cfg = await readGlobalConfig();
  const registry = cfg?.registry || (await getRegistry(opts, { cache: true }));
  await writeGlobalConfig({ registry, token: undefined });
  console.log("OK. Logged out locally. Token still valid until revoked (Settings -> API tokens).");
}

export async function cmdWhoami(opts: GlobalOpts) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });

  const spinner = createSpinner("Checking token");
  try {
    const whoami = await apiRequest(
      registry,
      { method: "GET", path: ApiRoutes.whoami, token },
      ApiV1WhoamiResponseSchema,
    );
    spinner.succeed(whoami.user.handle ?? "unknown");
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

/**
 * Device Flow login for headless environments.
 * Requests a device code, displays it to the user, then polls until authorized.
 */
export async function cmdDeviceLogin(opts: GlobalOpts) {
  const discovery = await discoverRegistryFromSite(opts.site).catch(() => null);
  const authBase = discovery?.authBase?.trim() || opts.site;

  const spinner = createSpinner("Requesting device code");
  let deviceCode;
  try {
    deviceCode = await requestDeviceCode({ siteUrl: authBase });
    spinner.succeed("Device code received");
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }

  // Display the code and URL for the user
  console.log();
  console.log("  To authenticate, visit:");
  console.log(`  ${deviceCode.verification_uri}`);
  console.log();
  console.log(`  And enter code: ${deviceCode.user_code}`);
  console.log();
  console.log(`  Code expires in ${Math.floor(deviceCode.expires_in / 60)} minutes.`);
  console.log();

  const pollSpinner = createSpinner("Waiting for authorization");
  try {
    const tokenResponse = await pollForDeviceToken(
      { siteUrl: authBase },
      deviceCode.device_code,
      { interval: deviceCode.interval, expiresIn: deviceCode.expires_in },
    );
    pollSpinner.succeed("Authorized");

    // Store the token
    await cmdLogin(opts, tokenResponse.access_token, true);
  } catch (error) {
    pollSpinner.fail(formatError(error));
    throw error;
  }
}
