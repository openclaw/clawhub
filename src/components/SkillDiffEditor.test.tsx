/* @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { type Mock, describe, expect, it, vi } from "vitest";
import { SkillDiffEditor } from "./SkillDiffEditor";

type Model = {
  getValue: () => string;
  setValue: Mock<(value: string) => void>;
  dispose: Mock<() => void>;
};
type Pair = { original: Model; modified: Model };
type Widget = {
  getModel: () => Pair | null;
  setModel: Mock<(value: Pair | null) => void>;
  getModifiedEditor: () => {
    getValue: () => string | undefined;
    setValue: Mock<(value: string) => void>;
  };
  updateOptions: Mock;
  dispose: Mock<() => void>;
};

function createMonaco() {
  const events: string[] = [];
  const models: Model[] = [];
  const widgets: Widget[] = [];

  function makeModel(initial: string): Model {
    let text = initial;
    const model: Model = {
      getValue: () => text,
      setValue: vi.fn((value: string) => {
        text = value;
      }),
      dispose: vi.fn(() => {
        expect(
          widgets.every((widget) => !Object.values(widget.getModel() ?? {}).includes(model)),
        ).toBe(true);
        events.push(`model:${initial}`);
      }),
    };
    models.push(model);
    return model;
  }

  function makeWidget(): Widget {
    let attached: Pair | null = null;
    const modifiedEditor = {
      getValue: () => attached?.modified.getValue(),
      setValue: vi.fn((value: string) => attached?.modified.setValue(value)),
    };
    const widget: Widget = {
      getModel: () => attached,
      setModel: vi.fn((value: typeof attached) => {
        attached = value;
        if (!value) events.push("detach");
      }),
      getModifiedEditor: () => modifiedEditor,
      updateOptions: vi.fn(),
      dispose: vi.fn(() => {
        expect(attached).toBeNull();
        events.push("widget");
      }),
    };
    widgets.push(widget);
    return widget;
  }

  const createDiffEditor = vi.fn(makeWidget);
  const createModel = vi.fn(makeModel);
  const setTheme = vi.fn();
  return {
    monaco: {
      editor: { createDiffEditor, createModel, setTheme },
    } as unknown as typeof import("monaco-editor"),
    createDiffEditor,
    createModel,
    setTheme,
    models,
    widgets,
    events,
  };
}

const options = { readOnly: true, renderSideBySide: true } as const;

describe("SkillDiffEditor", () => {
  it("attempts every cleanup after failed attachment and preserves the setup error", () => {
    const runtime = createMonaco();
    const setupError = new Error("Attachment failed");
    const createWidget = runtime.createDiffEditor.getMockImplementation()!;
    runtime.createDiffEditor.mockImplementationOnce(() => {
      const widget = createWidget();
      widget.setModel.mockImplementationOnce(() => {
        throw setupError;
      });
      widget.setModel.mockImplementationOnce(() => {
        throw new Error("Detach failed");
      });
      widget.dispose.mockImplementationOnce(() => {
        throw new Error("Widget disposal failed");
      });
      return widget;
    });

    expect(() =>
      render(
        <SkillDiffEditor
          monaco={runtime.monaco}
          original="before"
          modified="after"
          options={options}
          theme="clawhub-light"
          className="diff-monaco"
          onMount={vi.fn()}
        />,
      ),
    ).toThrow(setupError);
    expect(runtime.widgets[0].setModel).toHaveBeenCalledTimes(2);
    expect(runtime.widgets[0].dispose).toHaveBeenCalledTimes(1);
    expect(runtime.models.every((model) => model.dispose.mock.calls.length === 1)).toBe(true);
  });

  it("reports cleanup errors after attempting both model disposals on unmount", () => {
    const runtime = createMonaco();
    const { unmount } = render(
      <SkillDiffEditor
        monaco={runtime.monaco}
        original="before"
        modified="after"
        options={options}
        theme="clawhub-light"
        className="diff-monaco"
        onMount={vi.fn()}
      />,
    );
    const firstError = new Error("Original disposal failed");
    const secondError = new Error("Modified disposal failed");
    runtime.models[0].dispose.mockImplementationOnce(() => {
      throw firstError;
    });
    runtime.models[1].dispose.mockImplementationOnce(() => {
      throw secondError;
    });
    let failure: unknown;
    try {
      unmount();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([firstError, secondError]);
    expect(runtime.widgets[0].dispose).toHaveBeenCalledTimes(1);
    expect(runtime.models.every((model) => model.dispose.mock.calls.length === 1)).toBe(true);
  });

  it.each(["widget", "original", "modified", "attachment"])(
    "releases allocated resources when %s initialization fails",
    (stage) => {
      const runtime = createMonaco();
      const failure = new Error(`Failed ${stage}`);
      const fail = () => {
        throw failure;
      };
      if (stage === "widget") runtime.createDiffEditor.mockImplementationOnce(fail);
      if (stage === "original") runtime.createModel.mockImplementationOnce(fail);
      if (stage === "modified") {
        runtime.createModel
          .mockImplementationOnce(runtime.createModel.getMockImplementation()!)
          .mockImplementationOnce(fail);
      }
      if (stage === "attachment") {
        const createWidget = runtime.createDiffEditor.getMockImplementation()!;
        runtime.createDiffEditor.mockImplementationOnce(() => {
          const widget = createWidget();
          widget.setModel.mockImplementationOnce(fail);
          return widget;
        });
      }
      expect(() =>
        render(
          <SkillDiffEditor
            monaco={runtime.monaco}
            original="before"
            modified="after"
            options={options}
            theme="clawhub-light"
            className="diff-monaco"
            onMount={vi.fn()}
          />,
        ),
      ).toThrow(failure);
      expect(runtime.models.every((model) => model.dispose.mock.calls.length === 1)).toBe(true);
      expect(runtime.widgets.every((widget) => widget.dispose.mock.calls.length === 1)).toBe(true);
    },
  );

  it("detaches the pair before disposing the widget and both text models", () => {
    const runtime = createMonaco();
    const onMount = vi.fn();
    const { unmount } = render(
      <SkillDiffEditor
        monaco={runtime.monaco}
        original="before"
        modified="after"
        options={options}
        theme="clawhub-light"
        className="diff-monaco"
        onMount={onMount}
      />,
    );

    expect(runtime.createDiffEditor).toHaveBeenCalledWith(expect.any(HTMLDivElement), {
      automaticLayout: true,
      ...options,
    });
    expect(onMount).toHaveBeenCalledWith(runtime.widgets[0], runtime.monaco);
    expect(runtime.models.map((model) => model.getValue())).toEqual(["before", "after"]);
    unmount();

    expect(runtime.events).toEqual(["detach", "widget", "model:before", "model:after"]);
    expect(runtime.models.every((model) => model.dispose.mock.calls.length === 1)).toBe(true);
  });

  it("updates text, options and theme without replacing the live widget or models", () => {
    const runtime = createMonaco();
    const onMount = vi.fn();
    const props = {
      monaco: runtime.monaco,
      original: "before",
      modified: "after",
      options,
      theme: "clawhub-light",
      className: "diff-monaco",
      onMount,
    };
    const { rerender } = render(<SkillDiffEditor {...props} />);
    const pair = runtime.widgets[0].getModel();

    rerender(
      <SkillDiffEditor
        {...props}
        options={{ ...options, renderSideBySide: false }}
        theme="clawhub-dark"
      />,
    );
    expect(runtime.widgets[0].updateOptions).toHaveBeenLastCalledWith({
      ...options,
      renderSideBySide: false,
    });
    expect(runtime.setTheme).toHaveBeenLastCalledWith("clawhub-dark");
    expect(runtime.models.every((model) => model.setValue.mock.calls.length === 0)).toBe(true);

    rerender(<SkillDiffEditor {...props} original="new before" />);
    expect(runtime.models[0].setValue).toHaveBeenCalledExactlyOnceWith("new before");
    expect(runtime.widgets[0].getModifiedEditor().setValue).not.toHaveBeenCalled();
    rerender(<SkillDiffEditor {...props} original="new before" modified="new after" />);
    expect(runtime.widgets[0].getModifiedEditor().setValue).toHaveBeenCalledExactlyOnceWith(
      "new after",
    );
    expect(runtime.widgets[0].getModel()).toBe(pair);
    expect(runtime.createDiffEditor).toHaveBeenCalledTimes(1);
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(runtime.events).toEqual([]);
  });

  it("releases each StrictMode mount's own pair without disposing the replacement", () => {
    const runtime = createMonaco();
    const { unmount } = render(
      <StrictMode>
        <SkillDiffEditor
          monaco={runtime.monaco}
          original="before"
          modified="after"
          options={options}
          theme="clawhub-light"
          className="diff-monaco"
          onMount={vi.fn()}
        />
      </StrictMode>,
    );

    expect(runtime.widgets).toHaveLength(2);
    expect(runtime.widgets[0].dispose).toHaveBeenCalledTimes(1);
    expect(runtime.widgets[1].dispose).not.toHaveBeenCalled();
    expect(runtime.models.slice(0, 2).every((model) => model.dispose.mock.calls.length === 1)).toBe(
      true,
    );
    expect(runtime.models.slice(2).every((model) => model.dispose.mock.calls.length === 0)).toBe(
      true,
    );
    unmount();
    expect(runtime.models.every((model) => model.dispose.mock.calls.length === 1)).toBe(true);
  });
});
