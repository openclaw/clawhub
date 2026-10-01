/**
 * GitHub Device Flow authentication for headless environments.
 *
 * Implements RFC 8628 / GitHub's Device Flow:
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 *
 * This allows CLI authentication without a browser redirect to localhost,
 * enabling headless agents and remote servers to authenticate.
 */

type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

type DeviceTokenResponse = {
  access_token: string;
  token_type: string;
  scope: string;
};

type DeviceTokenErrorResponse = {
  error: string;
  error_description?: string;
  interval?: number;
};

type DeviceFlowConfig = {
  /** The ClawHub API URL that exposes device flow endpoints */
  apiUrl: string;
  /** The ClawHub site URL that hosts the verification page */
  siteUrl: string;
  /** Token label to show during approval and store on the created token */
  label?: string;
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
  const url = new URL("/api/cli/device/code", config.apiUrl);

  const body: Record<string, string> = {
    scope: config.scope ?? DEFAULT_SCOPE,
    site_url: config.siteUrl,
  };
  if (config.label) {
    body.label = config.label;
  }
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

  const data: unknown = await response.json().catch(() => null);

  if (!isDeviceCodeResponse(data)) {
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
  const url = new URL("/api/cli/device/token", config.apiUrl);
  const deadline = Date.now() + options.expiresIn * 1000;
  const expirationMessage = "Device code expired (timeout). Please try again.";
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

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let response: Response;
    try {
      response = await new Promise<Response>((resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(expirationMessage));
        }, remainingMs);
        void fetch(url.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }).then(resolve, reject);
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(expirationMessage, { cause: error });
      }
      throw error;
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }

    // Parse JSON once to avoid "body already read" errors
    const data: unknown = await response.json().catch(() => null);

    if (response.ok) {
      if (!isDeviceTokenResponse(data)) {
        throw new Error("Invalid device token response from server");
      }
      return data;
    }

    if (!isRecord(data)) {
      throw new Error("Invalid device token response from server");
    }

    const errorData = data as DeviceTokenErrorResponse;

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

  throw new Error(expirationMessage);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isDeviceCodeResponse(value: unknown): value is DeviceCodeResponse {
  return (
    isRecord(value) &&
    isNonEmptyString(value.device_code) &&
    isNonEmptyString(value.user_code) &&
    isNonEmptyString(value.verification_uri) &&
    isPositiveFiniteNumber(value.expires_in) &&
    isPositiveFiniteNumber(value.interval)
  );
}

function isDeviceTokenResponse(value: unknown): value is DeviceTokenResponse {
  return (
    isRecord(value) &&
    isNonEmptyString(value.access_token) &&
    isNonEmptyString(value.token_type) &&
    isNonEmptyString(value.scope)
  );
}
