import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { nextNavigationMock, setRoute, mockFetch, installBrowserShims } from "../helpers/ui";

vi.mock("next/navigation", () => nextNavigationMock());

import { ReportImprovement } from "@/components/report-improvement";
import { openReportImprovement } from "@/lib/client/report-improvement";

const ANALYSIS = {
  title: "Chat header is cramped",
  severity: "medium",
  summary: "The header packs six controls into one row on laptop widths.",
  suggestions: ["Move export behind a menu", "Drop the model label below 1200px"],
  related_areas: ["src/app/page.tsx", "src/styles/chat.css"],
};

/** The in-app feedback loop: note -> local model -> suggestions, all offline. */
describe("report improvement dialog", () => {
  beforeEach(() => {
    installBrowserShims();
    setRoute("/settings", "section=Reach");
    localStorage.clear();
  });

  async function open() {
    render(<ReportImprovement />);
    await act(async () => {
      openReportImprovement();
    });
  }

  it("stays closed until asked", () => {
    render(<ReportImprovement />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens from the global event and shows the current route", async () => {
    await open();
    expect(screen.getByRole("dialog", { name: "Report improvement" })).toBeInTheDocument();
    expect(screen.getByText("/settings?section=Reach")).toBeInTheDocument();
  });

  it("opens on ⌘⇧F", async () => {
    render(<ReportImprovement />);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "F", metaKey: true, shiftKey: true })
      );
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps submit disabled until there is something to report", async () => {
    const user = userEvent.setup();
    await open();
    const send = screen.getByRole("button", { name: /Send to local model/ });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("What should improve?"), "Header is cramped");
    expect(send).toBeEnabled();
  });

  it("posts the note and renders the model's suggestions", async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch([
      { match: "/api/reports/improvement", body: { report: { id: "rep_1" }, analysis: ANALYSIS } },
    ]);
    await open();
    await user.type(screen.getByLabelText("What should improve?"), "Header is cramped");
    await user.click(screen.getByRole("button", { name: /Send to local model/ }));

    await waitFor(() => expect(screen.getByText(ANALYSIS.title)).toBeInTheDocument());
    expect(screen.getByText(ANALYSIS.suggestions[0])).toBeInTheDocument();
    expect(screen.getByText(ANALYSIS.suggestions[1])).toBeInTheDocument();
    expect(screen.getByText("rep_1")).toBeInTheDocument();

    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.note).toBe("Header is cramped");
    expect(body.route).toBe("/settings?section=Reach");
    expect(body.screenshotDataUrl).toBeNull();
  });

  it("surfaces a server error and lets the user retry", async () => {
    const user = userEvent.setup();
    mockFetch([
      { match: "/api/reports/improvement", body: { error: "model offline" }, status: 503 },
    ]);
    await open();
    await user.type(screen.getByLabelText("What should improve?"), "Broken");
    await user.click(screen.getByRole("button", { name: /Send to local model/ }));

    await waitFor(() => expect(screen.getByText("model offline")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Send to local model/ })).toBeEnabled();
  });

  it("offers another report after finishing", async () => {
    const user = userEvent.setup();
    mockFetch([
      { match: "/api/reports/improvement", body: { report: { id: "rep_2" }, analysis: ANALYSIS } },
    ]);
    await open();
    await user.type(screen.getByLabelText("What should improve?"), "Slow");
    await user.click(screen.getByRole("button", { name: /Send to local model/ }));
    await waitFor(() => expect(screen.getByText(ANALYSIS.title)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Report another" }));
    expect(screen.getByLabelText("What should improve?")).toHaveValue("");
    expect(screen.queryByText(ANALYSIS.title)).not.toBeInTheDocument();
  });

  it("closes on Done, Cancel, the X, and Escape", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => openReportImprovement());
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => openReportImprovement());
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears the note between openings so reports do not leak into each other", async () => {
    const user = userEvent.setup();
    await open();
    await user.type(screen.getByLabelText("What should improve?"), "First");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => openReportImprovement());
    expect(screen.getByLabelText("What should improve?")).toHaveValue("");
  });
});
