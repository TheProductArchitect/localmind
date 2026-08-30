import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { routerMock, nextNavigationMock, installBrowserShims } from "../helpers/ui";

vi.mock("next/navigation", () => nextNavigationMock());

import { CommandPalette } from "@/components/command-palette";
import { REPORT_EVENT } from "@/lib/client/report-improvement";

/** ⌘K palette: the app's primary navigation for everything off the rail. */
describe("command palette", () => {
  beforeEach(() => {
    installBrowserShims();
    routerMock.push.mockClear();
  });

  async function openPalette() {
    render(<CommandPalette />);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    });
  }

  it("stays closed until ⌘K", () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on ⌘K and closes on a second ⌘K", async () => {
    await openPalette();
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    await openPalette();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("routes to a new conversation on ⌘N without opening", async () => {
    render(<CommandPalette />);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", metaKey: true }));
    });
    expect(routerMock.push).toHaveBeenCalledWith("/?new=1");
  });

  it("filters commands as you type", async () => {
    const user = userEvent.setup();
    await openPalette();
    await user.type(screen.getByPlaceholderText("Search actions, pages…"), "fleet");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Fleet · peers");
  });

  it("shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    await openPalette();
    await user.type(screen.getByPlaceholderText("Search actions, pages…"), "zzzzz");
    expect(screen.getByText("No matching commands.")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("navigates with arrows and runs the selection on Enter", async () => {
    const user = userEvent.setup();
    await openPalette();
    await user.type(screen.getByPlaceholderText("Search actions, pages…"), "settings ·");

    const before = screen.getAllByRole("option");
    expect(before[0]).toHaveAttribute("aria-selected", "true");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    });
    expect(routerMock.push).toHaveBeenCalledWith("/settings?section=Reach");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not run past the ends of the list", async () => {
    const user = userEvent.setup();
    await openPalette();
    await user.type(screen.getByPlaceholderText("Search actions, pages…"), "fleet ·");
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      });
    }
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    });
    expect(routerMock.push).toHaveBeenCalledWith("/fleet");
  });

  it("navigates when an option is clicked", async () => {
    const user = userEvent.setup();
    await openPalette();
    await user.click(screen.getByRole("option", { name: /Knowledge base/ }));
    expect(routerMock.push).toHaveBeenCalledWith("/knowledge");
  });

  it("raises the report dialog instead of navigating for Report improvement", async () => {
    const user = userEvent.setup();
    const onReport = vi.fn();
    window.addEventListener(REPORT_EVENT, onReport);
    await openPalette();
    await user.click(screen.getByRole("option", { name: /Report improvement/ }));
    expect(onReport).toHaveBeenCalled();
    expect(routerMock.push).not.toHaveBeenCalled();
    window.removeEventListener(REPORT_EVENT, onReport);
  });

  it("treats the palette's own toggle command as a no-op", async () => {
    const user = userEvent.setup();
    await openPalette();
    await user.click(screen.getByRole("option", { name: /Toggle command palette/ }));
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses when the backdrop is clicked but not the panel", async () => {
    const user = userEvent.setup();
    await openPalette();
    await user.click(screen.getByPlaceholderText("Search actions, pages…"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("resets the query between openings", async () => {
    const user = userEvent.setup();
    await openPalette();
    await user.type(screen.getByPlaceholderText("Search actions, pages…"), "fleet");
    await user.click(screen.getByRole("option", { name: /Fleet · peers/ }));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    });
    expect(screen.getByPlaceholderText("Search actions, pages…")).toHaveValue("");
  });
});
