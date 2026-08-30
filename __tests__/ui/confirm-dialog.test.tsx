import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installBrowserShims } from "../helpers/ui";
import { ConfirmProvider, useConfirm } from "@/components/confirm-dialog";

/**
 * The confirm gate in front of every destructive action. A regression here
 * means either silent data loss (auto-confirm) or a dead button (never resolves).
 */

function Subject({ onResult, destructive = false }: { onResult: (v: boolean) => void; destructive?: boolean }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await confirm({
          title: "Delete conversation",
          message: "This cannot be undone.",
          confirmLabel: "Delete",
          cancelLabel: "Keep",
          destructive,
        });
        onResult(ok);
      }}
    >
      Trigger
    </button>
  );
}

describe("confirm dialog", () => {
  beforeEach(() => installBrowserShims());

  it("does not render until something asks for confirmation", () => {
    render(
      <ConfirmProvider>
        <Subject onResult={vi.fn()} />
      </ConfirmProvider>
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows the title, message and custom labels", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <Subject onResult={vi.fn()} />
      </ConfirmProvider>
    );
    await user.click(screen.getByRole("button", { name: "Trigger" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Delete conversation");
    expect(dialog).toHaveAccessibleDescription("This cannot be undone.");
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
  });

  it("resolves true and closes when confirmed", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <Subject onResult={onResult} />
      </ConfirmProvider>
    );
    await user.click(screen.getByRole("button", { name: "Trigger" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("resolves false when cancelled", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <Subject onResult={onResult} />
      </ConfirmProvider>
    );
    await user.click(screen.getByRole("button", { name: "Trigger" }));
    await user.click(screen.getByRole("button", { name: "Keep" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("resolves false on backdrop click", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <Subject onResult={onResult} />
      </ConfirmProvider>
    );
    await user.click(screen.getByRole("button", { name: "Trigger" }));
    await user.click(screen.getByRole("alertdialog"));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("resolves false on Escape", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <Subject onResult={onResult} />
      </ConfirmProvider>
    );
    await user.click(screen.getByRole("button", { name: "Trigger" }));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("marks destructive confirms so the pulse reads as destructive", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <Subject onResult={vi.fn()} destructive />
      </ConfirmProvider>
    );
    await user.click(screen.getByRole("button", { name: "Trigger" }));
    expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute(
      "data-pulse-action",
      "destructive"
    );
  });

  it("falls back to window.confirm outside a provider so callers never hang", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onResult = vi.fn();
    render(<Subject onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Trigger" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    spy.mockRestore();
  });
});
