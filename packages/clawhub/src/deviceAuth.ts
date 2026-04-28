/**
 * GitHub Device Flow authentication for headless environments.
 *
 * Implements RFC 8628 / GitHub's Device Flow:
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 *
 * This allows CLI authentication without a browser redirect to localhost,
 * enabling headless agents and remote servers to authenticate.
 */

export type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

export type DeviceTokenResponse = {
  access_token: string;
  token_type: string;
  scope: string;
};

export type DeviceTokenErrorResponse = {
  error: string;
  error_description?: string;
  interval?: number;
};

export type DeviceFlowConfig = {
  /** The ClawHub site URL that exposes device flow endpoints */
  siteUrl: string;
  /** Client ID for the OAuth app (provided by ClawHub) */
  clientId?: string;
  /** Scope to request */
  scope?: string;
};

const DEFAULT_SCOPE = "read write";

/**
 * Request a device code from the ClawHub device flow endpoint.
 */
export async function requestDeviceCode(config: DeviceFlowConfig): Promise<DeviceCodeResponse> {
  const url = new URL("/cli/device/code", config.siteUrl);

  const body: Record<string, string> = {
    scope: config.scope ?? DEFAULT_SCOPE,
  };
  if (config.clientId) {
    body.client_id = config.clientId;
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Device code request failed (${response.status}): ${text || response.statusText}`,
    );
  }

  const data = (await response.json()) as DeviceCodeResponse;

  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error("Invalid device code response from server");
  }

  return data;
}

/**
 * Poll for the device flow token until the user completes authorization,
 * the code expires, or an unrecoverable error occurs.
 */
export async function pollForDeviceToken(
  config: DeviceFlowConfig,
  deviceCode: string,
  options: { interval: number; expiresIn: number },
): Promise<DeviceTokenResponse> {
  const url = new URL("/cli/device/token", config.siteUrl);
  const deadline = Date.now() + options.expiresIn * 1000;
  let interval = options.interval * 1000;

  const body: Record<string, string> = {
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  };
  if (config.clientId) {
    body.client_id = config.clientId;
  }

  while (Date.now() < deadline) {
    await sleep(interval);

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const data = (await response.json()) as DeviceTokenResponse;
      if (data.access_token) return data;
    }

    const errorData = (await response.json().catch(() => ({}))) as DeviceTokenErrorResponse;

    switch (errorData.error) {
      case "authorization_pending":
        // User hasn't completed auth yet — keep polling
        break;
      case "slow_down":
        // Server requests longer interval
        interval = (errorData.interval ?? Math.ceil(interval / 1000) + 5) * 1000;
        break;
      case "expired_token":
        throw new Error("Device code expired. Please try again.");
      case "access_denied":
        throw new Error("Authorization denied by user.");
      default:
        throw new Error(
          `Device flow error: ${errorData.error_description || errorData.error || "unknown error"}`,
        );
    }
  }

  throw new Error("Device code expired (timeout). Please try again.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
