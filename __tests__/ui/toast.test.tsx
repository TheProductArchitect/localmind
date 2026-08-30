import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Toaster, toast } from "@/components/toast";
import { installBrowserShims } from "../helpers/ui";

/** Toasts are how every button reports success/failure — including coalescing. */
describe("toaster", () => {
  beforeEach(() => {
    installBrowserShims();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  function show(message: string, variant?: "info" | "success" | "error") {
    act(() => {
      toast(message, variant);
    });
  }

  it("exposes a polite live region even when empty", () => {
    render(<Toaster />);
    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("renders a message and its variant", () => {
    render(<Toaster />);
    show("Saved", "success");
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Saved").closest(".lm-toast")).toHaveAttribute(
      "data-variant",
      "success"
    );
  });

  it("coalesces a repeated message into one card with a count", () => {
    render(<Toaster />);
    show("Moved to trash");
    show("Moved to trash");
    show("Moved to trash");
    expect(screen.getAllByText("Moved to trash")).toHaveLength(1);
    expect(screen.getByText("×3")).toBeInTheDocument();
  });

  it("keeps the same text under different variants apart", () => {
    render(<Toaster />);
    show("Sync", "info");
    show("Sync", "error");
    expect(screen.getAllByText("Sync")).toHaveLength(2);
  });

  it("dismisses a toast after its lifetime", () => {
    render(<Toaster />);
    show("Transient");
    act(() => {
      vi.advanceTimersByTime(4200 + 300);
    });
    expect(screen.queryByText("Transient")).not.toBeInTheDocument();
  });

  it("caps the visible stack at four cards", () => {
    render(<Toaster />);
    ["one", "two", "three", "four", "five"].forEach((m) => show(m));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText("one")).not.toBeInTheDocument();
    expect(screen.getByText("five")).toBeInTheDocument();
  });

  it("stops listening after unmount", () => {
    const { unmount } = render(<Toaster />);
    unmount();
    expect(() => show("after unmount")).not.toThrow();
  });
});
