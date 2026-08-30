import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onActivate } from "@/lib/client/keyboard";

/**
 * `onActivate` is what makes the div-based rows (conversations, notes, projects,
 * browser tabs) reachable by keyboard, so its edge cases are load-bearing.
 */
describe("onActivate", () => {
  function Row({ onOpen, onNested }: { onOpen: () => void; onNested?: () => void }) {
    return (
      <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={onActivate(onOpen)}>
        Row
        {onNested && (
          <button
            type="button"
            onClick={(e) => {
              // Rows listen for bubbled clicks, so nested controls must stop them.
              e.stopPropagation();
              onNested();
            }}
          >
            Star
          </button>
        )}
      </div>
    );
  }

  it("activates on Enter", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<Row onOpen={onOpen} />);
    screen.getByRole("button", { name: /Row/ }).focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("activates on Space", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<Row onOpen={onOpen} />);
    screen.getByRole("button", { name: /Row/ }).focus();
    await user.keyboard(" ");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys, including Tab and typing", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<Row onOpen={onOpen} />);
    screen.getByRole("button", { name: /Row/ }).focus();
    await user.keyboard("{Escape}abc{ArrowDown}");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("is reachable by Tab", async () => {
    const user = userEvent.setup();
    render(<Row onOpen={vi.fn()} />);
    await user.tab();
    expect(screen.getByRole("button", { name: /Row/ })).toHaveFocus();
  });

  it("leaves keys pressed inside a nested control to that control", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onNested = vi.fn();
    render(<Row onOpen={onOpen} onNested={onNested} />);
    screen.getByRole("button", { name: "Star" }).focus();
    await user.keyboard("{Enter}");
    expect(onNested).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("ignores key events that originated in a descendant", () => {
    const onOpen = vi.fn();
    const handler = onActivate(onOpen);
    handler({
      key: "Enter",
      target: {} as EventTarget,
      currentTarget: {} as EventTarget,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("prevents the default so Space does not scroll the list", () => {
    const handler = onActivate(vi.fn());
    const target = {} as EventTarget;
    const preventDefault = vi.fn();
    handler({
      key: " ",
      target,
      currentTarget: target,
      preventDefault,
    } as unknown as React.KeyboardEvent);
    expect(preventDefault).toHaveBeenCalled();
  });
});
