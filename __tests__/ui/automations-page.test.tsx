import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installBrowserShims, mockFetch } from "../helpers/ui";

vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

import AutomationsPage from "@/app/automations/page";

describe("automations page", () => {
  it("shows the latest browser-delivered result instead of hiding it in logs", async () => {
    installBrowserShims();
    mockFetch([
      {
        match: "/api/automations/tasks",
        body: {
          tasks: [
            {
              id: "task-1",
              name: "Morning briefing",
              schedule: "daily at 08:00",
              delivery_channel: "browser",
              enabled: 1,
              last_run_at: Date.now(),
              last_output: "Today: project review at 10:00.",
            },
          ],
        },
      },
    ]);
    render(<AutomationsPage />);

    await waitFor(() =>
      expect(screen.getByText("Morning briefing")).toBeInTheDocument()
    );
    expect(screen.queryByText("Today: project review at 10:00.")).not.toBeVisible();

    await userEvent.setup().click(screen.getByText("Latest result"));
    expect(screen.getByText("Today: project review at 10:00.")).toBeVisible();
  });
});
