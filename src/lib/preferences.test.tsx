/* @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePreferences, getStoredPreferencesSnapshot } from "./preferences";

const PREFERENCES_KEY = "clawhub-preferences";

function PreferencesProbe() {
  const { preferences, updatePreference, isAdvancedMode } = usePreferences();

  return (
    <div>
      <div data-testid="density">{preferences.layoutDensity}</div>
      <div data-testid="advanced">{String(isAdvancedMode)}</div>
      <button
        type="button"
        onClick={() => updatePreference("advancedMode", !preferences.advancedMode)}
      >
        Toggle advanced
      </button>
    </div>
  );
}

describe("preferences store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns a stable snapshot when storage has not changed", () => {
    const first = getStoredPreferencesSnapshot();
    const second = getStoredPreferencesSnapshot();

    expect(first).toBe(second);
    expect(first.layoutDensity).toBe("comfortable");
  });

  it("falls back to defaults when localStorage reads throw", () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });

    render(<PreferencesProbe />);

    expect(screen.getByTestId("density").textContent).toBe("comfortable");
    expect(screen.getByTestId("advanced").textContent).toBe("false");

    getItemSpy.mockRestore();
  });

  it("resets to defaults when the preference key is cleared in another tab", () => {
    window.localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({
        advancedMode: true,
        layoutDensity: "compact",
      }),
    );

    render(<PreferencesProbe />);
    expect(screen.getByTestId("advanced").textContent).toBe("true");
    expect(screen.getByTestId("density").textContent).toBe("compact");

    window.localStorage.removeItem(PREFERENCES_KEY);
    act(() => {
      const event = Object.assign(new Event("storage"), {
        key: PREFERENCES_KEY,
        newValue: null,
        oldValue: JSON.stringify({
          advancedMode: true,
          layoutDensity: "compact",
        }),
        storageArea: window.localStorage,
      });
      window.dispatchEvent(event);
    });

    expect(screen.getByTestId("advanced").textContent).toBe("false");
    expect(screen.getByTestId("density").textContent).toBe("comfortable");
  });

  it("re-renders cleanly after a preference update", () => {
    window.localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({
        advancedMode: false,
      }),
    );

    render(<PreferencesProbe />);

    expect(screen.getByTestId("advanced").textContent).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /toggle advanced/i }));

    expect(screen.getByTestId("advanced").textContent).toBe("true");
    expect(JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? "{}")).toMatchObject({
      advancedMode: true,
    });
  });

  it("does not cache a preference change when storage writes fail", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });

    render(<PreferencesProbe />);
    expect(screen.getByTestId("advanced").textContent).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /toggle advanced/i }));

    expect(screen.getByTestId("advanced").textContent).toBe("false");
    expect(window.localStorage.getItem(PREFERENCES_KEY)).toBeNull();

    setItemSpy.mockRestore();
  });
});
