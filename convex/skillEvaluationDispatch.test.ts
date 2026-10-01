import { describe, expect, it, vi } from "vitest";
import {
  dispatchSkillEvaluationWorkflow,
  isSkillEvaluationEventDispatchEnabled,
} from "./skillEvaluationDispatch";

describe("skillEvaluationDispatch", () => {
  it("stays disabled without the existing production dispatch credentials", () => {
    expect(isSkillEvaluationEventDispatchEnabled({})).toBe(false);
    expect(
      isSkillEvaluationEventDispatchEnabled({
        SECURITY_SCAN_EVENT_DISPATCH_ENABLED: "1",
        GITHUB_APP_ID: "id",
        GITHUB_APP_INSTALLATION_ID: "installation",
        GITHUB_APP_PRIVATE_KEY: "key",
      }),
    ).toBe(true);
  });

  it("dispatches the dedicated worker event", async () => {
    const fetchImpl = async () => new Response(null, { status: 204 });
    const fetchSpy = vi.fn(fetchImpl);

    await expect(
      dispatchSkillEvaluationWorkflow(
        { token: "installation-token", permissions: { contents: "write" } },
        fetchSpy,
      ),
    ).resolves.toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.github.com/repos/openclaw/clawhub/dispatches",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          event_type: "clawhub-skill-evaluation",
          client_payload: { batch_limit: "1", max_runtime_minutes: "170" },
        }),
      }),
    );
  });
});
