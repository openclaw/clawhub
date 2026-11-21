import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLoadMoreObserver } from "./useLoadMoreObserver";

const observers: Array<{
  callback: IntersectionObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}> = [];

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(callback: IntersectionObserverCallback) {
        observers.push({ callback, observe: this.observe, disconnect: this.disconnect });
      }
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Target({
  enabled,
  loadMore,
  mounted = true,
}: {
  enabled: boolean;
  loadMore: () => void;
  mounted?: boolean;
}) {
  const ref = useLoadMoreObserver(enabled, loadMore);
  return mounted ? <div ref={ref} data-testid="target" /> : null;
}

it("does not observe or request when disabled, missing a target, or without the API", () => {
  const loadMore = vi.fn();
  const view = render(<Target enabled={false} loadMore={loadMore} />);
  expect(observers).toHaveLength(0);
  view.rerender(<Target enabled loadMore={loadMore} mounted={false} />);
  expect(observers).toHaveLength(0);
  vi.stubGlobal("IntersectionObserver", undefined);
  view.rerender(<Target enabled={false} loadMore={loadMore} />);
  view.rerender(<Target enabled loadMore={loadMore} />);
  expect(observers).toHaveLength(0);
  expect(loadMore).not.toHaveBeenCalled();
});

it("retains its target and rearms for callback or enabled changes with cleanup", () => {
  const first = vi.fn();
  const next = vi.fn();
  const view = render(<Target enabled={false} loadMore={first} />);
  const target = view.getByTestId("target");
  view.rerender(<Target enabled loadMore={first} />);
  expect(observers).toHaveLength(1);
  expect(observers[0].observe).toHaveBeenCalledWith(target);
  view.rerender(<Target enabled loadMore={first} />);
  expect(observers).toHaveLength(1);
  view.rerender(<Target enabled loadMore={next} />);
  expect(observers[0].disconnect).toHaveBeenCalledOnce();
  expect(observers).toHaveLength(2);
  expect(observers[1].observe).toHaveBeenCalledWith(target);
  act(() =>
    observers[1].callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  expect(first).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledOnce();
  view.rerender(<Target enabled={false} loadMore={next} />);
  expect(observers[1].disconnect).toHaveBeenCalledTimes(2);
  view.rerender(<Target enabled loadMore={next} />);
  expect(observers[2].observe).toHaveBeenCalledWith(target);
  view.unmount();
  expect(observers[2].disconnect).toHaveBeenCalledOnce();
});
