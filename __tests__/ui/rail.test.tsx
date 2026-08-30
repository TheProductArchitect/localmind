import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { nextNavigationMock, setRoute, installBrowserShims } from "../helpers/ui";

vi.mock("next/navigation", () => nextNavigationMock());

vi.mock("@/lib/client/pulse-store", () => ({
  subscribePulse: (cb: (p: {
    state: string;
    processes: number;
    graphs: number;
    subagents: number;
    suspended: boolean;
  }) => void) => {
    cb({ state: "idle", processes: 0, graphs: 0, subagents: 0, suspended: false });
    return () => {};
  },
}));

vi.mock("@/components/orb", () => ({
  Orb: ({ ariaLabel }: { ariaLabel?: string }) => <div data-testid="orb" aria-label={ariaLabel} />,
}));

import { Rail } from "@/components/rail";
import { REPORT_EVENT } from "@/lib/client/report-improvement";

const DESTS = [
  { href: "/", label: "Chat" },
  { href: "/work", label: "Work" },
  { href: "/ops", label: "Ops" },
  { href: "/projects", label: "Projects" },
  { href: "/browse", label: "Browse" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/fleet", label: "Fleet" },
  { href: "/settings", label: "Settings" },
] as const;

/** Left nav rail (desktop + mobile) — every destination and the report control. */
describe("rail", () => {
  beforeEach(() => {
    installBrowserShims();
    setRoute("/");
  });

  it("renders every destination with its accessible label and href", () => {
    render(<Rail />);
    for (const d of DESTS) {
      const links = screen.getAllByRole("link", { name: d.label });
      expect(links.length).toBeGreaterThanOrEqual(2);
      for (const link of links) {
        expect(link).toHaveAttribute("href", d.href);
      }
    }
    expect(screen.getByRole("link", { name: "LocalMind home" })).toHaveAttribute("href", "/");
  });

  it("marks the active destination for several routes", () => {
    const cases: { path: string; label: string }[] = [
      { path: "/", label: "Chat" },
      { path: "/projects", label: "Projects" },
      { path: "/knowledge", label: "Knowledge" },
      { path: "/memory", label: "Knowledge" },
      { path: "/data", label: "Knowledge" },
      { path: "/fleet", label: "Fleet" },
      { path: "/models", label: "Fleet" },
      { path: "/settings", label: "Settings" },
      { path: "/work", label: "Work" },
      { path: "/graphs", label: "Work" },
      { path: "/ops", label: "Ops" },
      { path: "/browse", label: "Browse" },
    ];

    for (const { path, label } of cases) {
      setRoute(path);
      const { unmount } = render(<Rail />);
      const links = screen.getAllByRole("link", { name: label });
      for (const link of links) {
        expect(link).toHaveClass("is-active");
      }
      for (const other of DESTS.filter((d) => d.label !== label)) {
        for (const link of screen.getAllByRole("link", { name: other.label })) {
          expect(link).not.toHaveClass("is-active");
        }
      }
      unmount();
    }
  });

  it("hides on login and onboarding", () => {
    setRoute("/login");
    const { unmount } = render(<Rail />);
    expect(screen.queryByRole("link", { name: "Chat" })).not.toBeInTheDocument();
    unmount();

    setRoute("/onboarding");
    render(<Rail />);
    expect(screen.queryByRole("link", { name: "Chat" })).not.toBeInTheDocument();
  });

  it("dispatches the report event from Report improvement", async () => {
    const user = userEvent.setup();
    const onReport = vi.fn();
    window.addEventListener(REPORT_EVENT, onReport);
    render(<Rail />);
    await user.click(screen.getByRole("button", { name: "Report improvement" }));
    expect(onReport).toHaveBeenCalledTimes(1);
    window.removeEventListener(REPORT_EVENT, onReport);
  });

  it("carries tooltip labels on desktop rail tips", () => {
    render(<Rail />);
    const tips = [...document.querySelectorAll(".lm-rail-tip")].map((el) => el.textContent);
    for (const d of DESTS) {
      expect(tips).toContain(d.label);
    }
    expect(tips).toContain("Report");
  });

  it("puts data-pulse markers on every rail control", () => {
    render(<Rail />);
    const pulsed = document.querySelectorAll('[data-pulse="true"]');
    expect(pulsed.length).toBeGreaterThanOrEqual(DESTS.length * 2 + 2); // dests×2 + home + report
    for (const el of pulsed) {
      expect(el).toHaveAttribute("data-pulse-style", "rail");
    }
  });

  it("renders the same destinations on the mobile rail", () => {
    render(<Rail />);
    const mobile = document.querySelector("nav.md\\:hidden") ?? document.querySelectorAll("nav")[1];
    expect(mobile).toBeTruthy();
    const scope = within(mobile as HTMLElement);
    for (const d of DESTS) {
      const link = scope.getByRole("link", { name: d.label });
      expect(link).toHaveAttribute("href", d.href);
      expect(link).toHaveAttribute("data-pulse", "true");
      expect(link).toHaveAttribute("data-pulse-style", "rail");
    }
  });
});
