import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { nextNavigationMock, setRoute, mockFetch, installBrowserShims } from "../helpers/ui";

vi.mock("next/navigation", () => nextNavigationMock());

vi.mock("@/components/branding-sync", () => ({
  notifyAssistantName: vi.fn(),
}));

vi.mock("@/lib/client/settings-cache", () => ({
  patchSettingsCache: vi.fn(),
}));

import Onboarding from "@/app/onboarding/page";

function stubLocation() {
  const loc = { href: "http://localhost/onboarding" };
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: loc,
  });
  return loc;
}

const INSTALLED = [{ name: "llama3.2:3b", family: "llama", size: 2e9, modified: "2024-01-01" }];

/** First-run wizard: steps, validation, model pick, finish/bootstrap. */
describe("onboarding page", () => {
  let loc: { href: string };

  beforeEach(() => {
    installBrowserShims();
    setRoute("/onboarding");
    loc = stubLocation();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function modelsRoute(models = INSTALLED) {
    return { match: "/api/models", body: { models } };
  }

  function settingsRoute() {
    return { match: "/api/settings", body: { ok: true } };
  }

  function bootstrapRoute() {
    return { match: "/api/auth/bootstrap", body: { ok: true } };
  }

  it("starts on step 1 and advances with Continue", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Onboarding />);
    expect(screen.getByText("Step 1 of 6")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Welcome to LocalMind/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Step 2 of 6")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Choose your AI runtime/ })).toBeInTheDocument();
  });

  it("moves Back and Continue between early steps", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Onboarding />);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step 1 of 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Step 3 of 6")).toBeInTheDocument();
  });

  it("blocks Continue on the model step until a model is ready", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockFetch([modelsRoute([])]);
    render(<Onboarding />);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText(/Pull your first model|Looking for models/)).toBeInTheDocument());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  });

  async function advanceToModelStep(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    // Installed model auto-selects → Continue (not Download) appears.
    await waitFor(() => {
      expect(screen.getByText("Already installed on this machine")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    });
  }

  it("selects an installed model and continues to naming", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = mockFetch([modelsRoute(), settingsRoute()]);
    render(<Onboarding />);
    await advanceToModelStep(user);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText("Step 4 of 6")).toBeInTheDocument());
    const patch = calls.find((c) => c.url.includes("/api/settings") && c.init?.method === "PATCH");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      active_model: "llama3.2:3b",
      provider: "ollama",
    });
    expect(screen.getByRole("heading", { name: /Name and personality/ })).toBeInTheDocument();
  });

  it("honors Skip for now on the naming step", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockFetch([modelsRoute(), settingsRoute()]);
    render(<Onboarding />);
    await advanceToModelStep(user);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("Step 4 of 6")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(screen.getByText("Step 5 of 6")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /What can it access/ })).toBeInTheDocument();
  });

  it("walks through permissions to the PIN step", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockFetch([modelsRoute(), settingsRoute()]);
    render(<Onboarding />);
    await advanceToModelStep(user);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("Step 4 of 6")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Step 5 of 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Step 6 of 6")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Set a PIN/ })).toBeInTheDocument();
  });

  it("POSTs setup + bootstrap on Finish setup and routes home", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = mockFetch([modelsRoute(), settingsRoute(), bootstrapRoute()]);
    render(<Onboarding />);
    await advanceToModelStep(user);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("Step 4 of 6")).toBeInTheDocument());

    const nameInput = screen.getByDisplayValue("Assistant");
    await user.clear(nameInput);
    await user.type(nameInput, "Sora");
    await user.click(screen.getByRole("button", { name: "Professional" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await user.type(screen.getByPlaceholderText("4+ digit PIN"), "4242");
    await user.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(loc.href).toBe("/"));

    const patches = calls.filter((c) => c.url.includes("/api/settings") && c.init?.method === "PATCH");
    const finishPatch = patches.find((c) => {
      const body = JSON.parse(String(c.init?.body));
      return body.onboarded === 1;
    });
    expect(finishPatch).toBeTruthy();
    expect(JSON.parse(String(finishPatch?.init?.body))).toEqual({
      assistant_name: "Sora",
      personality: "Professional",
      onboarded: 1,
      pin: "4242",
    });

    const boot = calls.find((c) => c.url.includes("/api/auth/bootstrap"));
    expect(boot?.init?.method).toBe("POST");
    expect(JSON.parse(String(boot?.init?.body))).toEqual({
      display_name: "Sora",
      pin: "4242",
    });
  });

  it("bootstraps with a default PIN when the PIN step is left empty", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = mockFetch([modelsRoute(), settingsRoute(), bootstrapRoute()]);
    render(<Onboarding />);
    await advanceToModelStep(user);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("Step 4 of 6")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(loc.href).toBe("/"));
    const boot = calls.find((c) => c.url.includes("/api/auth/bootstrap"));
    expect(JSON.parse(String(boot?.init?.body))).toEqual({
      display_name: "Assistant",
      pin: "0000",
    });
    const finishPatch = calls.find((c) => {
      if (!c.url.includes("/api/settings") || c.init?.method !== "PATCH") return false;
      const body = JSON.parse(String(c.init?.body));
      return body.onboarded === 1;
    });
    expect(JSON.parse(String(finishPatch?.init?.body))).toEqual({
      assistant_name: "Assistant",
      personality: "Friendly",
      onboarded: 1,
    });
  });
});
