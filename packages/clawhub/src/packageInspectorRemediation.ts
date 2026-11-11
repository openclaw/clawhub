export const LEGACY_AUTHOR_REMEDIATION_SUMMARIES = {
  "channel-env-vars":
    "Move legacy channel environment variable metadata into the current setup/config metadata.",
  "legacy-before-agent-start":
    "Replace the legacy before_agent_start hook with the current prompt/model hooks.",
  "legacy-root-sdk-import":
    "Prefer focused public plugin SDK subpath imports instead of the legacy root barrel.",
  "manifest-name-missing": "Add a display name to the plugin manifest.",
  "manifest-unknown-contracts":
    "Remove unsupported manifest contract keys or move them to a documented OpenClaw contract field.",
  "manifest-unknown-fields":
    "Move unsupported top-level manifest fields into supported package metadata or remove them.",
  "package-entrypoint-missing":
    "Publish the entrypoint declared in OpenClaw package metadata or update the metadata to point at an existing file.",
  "package-install-metadata-incomplete":
    "Complete the OpenClaw install metadata so ClawHub can identify the install target.",
  "package-json-missing": "Add a package.json to the plugin package.",
  "package-manifest-version-drift":
    "Align the plugin version declared in package.json and openclaw.plugin.json.",
  "package-min-host-version-drift":
    "Set the package minimum host version to the OpenClaw version range the plugin was built and tested against.",
  "package-npm-pack-entrypoint-missing":
    "Include the declared OpenClaw entrypoints in the npm-packed artifact.",
  "package-npm-pack-metadata-missing":
    "Include OpenClaw metadata files in the npm-packed artifact.",
  "package-npm-pack-unavailable": "Make the package packable before publishing it through ClawHub.",
  "package-openclaw-entry-missing":
    "Declare the plugin runtime entrypoint in package.json OpenClaw metadata.",
  "package-openclaw-metadata-missing": "Add the package.json openclaw metadata block.",
  "package-openclaw-unsupported-metadata": "Remove unsupported OpenClaw package metadata fields.",
  "package-plugin-api-compat-missing":
    "Declare the OpenClaw plugin API range this package supports.",
  "provider-auth-env-vars":
    "Move legacy provider authentication environment variables into current provider setup metadata.",
  "reserved-sdk-import": "Stop importing reserved bundled-plugin SDK compatibility paths.",
  "security-manifest-schema-unavailable":
    "Remove or update the unsupported security manifest schema reference.",
  "sdk-load-session-store":
    "Replace deprecated loadSessionStore whole-store access with row-scoped session helpers.",
  "sdk-session-file-helper":
    "Replace deprecated session file-path helpers with session entry and transcript identity APIs.",
  "sdk-session-store-write":
    "Replace deprecated whole-store session writes with row-scoped session helpers.",
  "sdk-session-transcript-file-target":
    "Replace legacy transcript file targets with public transcript identity or target helpers.",
  "sdk-session-transcript-low-level":
    "Replace low-level transcript writes with the structured transcript runtime helpers.",
  "unrecognized-security-manifest":
    "Remove unsupported security manifest files until OpenClaw documents a versioned security manifest schema.",
} as const;
