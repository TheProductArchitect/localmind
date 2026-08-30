import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { nextNavigationMock, setRoute, mockFetch, installBrowserShims } from "../helpers/ui";

vi.mock("next/navigation", () => nextNavigationMock());

const startAuthentication = vi.fn(async (_options?: unknown) => ({ id: "assertion-1", response: {} }));
vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: (options: unknown) => startAuthentication(options),
}));

import LoginPage from "@/app/login/page";

const ACCOUNTS = [
  { id: "u1", display_name: "Ada", role: "owner" },
  { id: "u2", display_name: "Bob", role: "member" },
];

function stubLocation() {
  const loc = { href: "http://localhost/login" };
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: loc,
  });
  return loc;
}

/** Sign-in: account pick, PIN, passkey, and redirect guards. */
describe("login page", () => {
  let loc: { href: string };

  beforeEach(() => {
    installBrowserShims();
    setRoute("/login");
    loc = stubLocation();
    startAuthentication.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function readyWithAccounts(accounts = ACCOUNTS) {
    mockFetch([{ match: "/api/auth/me", body: { user: null, hasUsers: true, accounts } }]);
    render(<LoginPage />);
    await waitFor(() => {
      if (accounts.length === 1) {
        expect(screen.getByText(new RegExp(accounts[0].display_name))).toBeInTheDocument();
      } else {
        expect(screen.getByText("Ada")).toBeInTheDocument();
      }
    });
  }

  it("redirects to home when already signed in", async () => {
    mockFetch([{ match: "/api/auth/me", body: { user: { id: "u1" }, hasUsers: true } }]);
    render(<LoginPage />);
    await waitFor(() => expect(loc.href).toBe("/"));
  });

  it("redirects to onboarding when there are no users", async () => {
    mockFetch([{ match: "/api/auth/me", body: { user: null, hasUsers: false } }]);
    render(<LoginPage />);
    await waitFor(() => expect(loc.href).toBe("/onboarding"));
  });

  it("keeps Sign in disabled until the PIN has 4+ digits", async () => {
    const user = userEvent.setup();
    await readyWithAccounts([ACCOUNTS[0]]);
    const signIn = screen.getByRole("button", { name: "Sign in" });
    expect(signIn).toBeDisabled();
    await user.type(screen.getByPlaceholderText("PIN"), "123");
    expect(signIn).toBeDisabled();
    await user.type(screen.getByPlaceholderText("PIN"), "4");
    expect(signIn).toBeEnabled();
  });

  it("POSTs credentials and routes home on success", async () => {
    const user = userEvent.setup();
    await readyWithAccounts([ACCOUNTS[0]]);
    const { calls } = mockFetch([
      { match: "/api/auth/me", body: { user: null, hasUsers: true, accounts: [ACCOUNTS[0]] } },
      { match: "/api/auth/login", body: { ok: true } },
    ]);
    await user.type(screen.getByPlaceholderText("PIN"), "1234");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(loc.href).toBe("/"));
    const login = calls.find((c) => c.url.includes("/api/auth/login"));
    expect(login?.init?.method).toBe("POST");
    expect(JSON.parse(String(login?.init?.body))).toEqual({ userId: "u1", pin: "1234" });
  });

  it("shows an error and does not navigate on wrong credentials", async () => {
    const user = userEvent.setup();
    await readyWithAccounts([ACCOUNTS[0]]);
    mockFetch([
      { match: "/api/auth/me", body: { user: null, hasUsers: true, accounts: [ACCOUNTS[0]] } },
      { match: "/api/auth/login", body: { error: "Invalid PIN" }, status: 401 },
    ]);
    await user.type(screen.getByPlaceholderText("PIN"), "9999");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByText("Invalid PIN")).toBeInTheDocument());
    expect(loc.href).toBe("http://localhost/login");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("lets the user pick an account when several exist", async () => {
    const user = userEvent.setup();
    await readyWithAccounts();
    await user.click(screen.getByRole("button", { name: /Bob/ }));
    expect(screen.getByText(/Signing in as/)).toHaveTextContent("Bob");
    await user.click(screen.getByRole("button", { name: /Choose a different account/ }));
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("disables Sign in while a request is in flight", async () => {
    const user = userEvent.setup();
    await readyWithAccounts([ACCOUNTS[0]]);

    let resolveLogin!: (v: unknown) => void;
    const loginPromise = new Promise((r) => {
      resolveLogin = r;
    });
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/me")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ user: null, hasUsers: true, accounts: [ACCOUNTS[0]] }),
          text: async () => "",
          headers: new Headers(),
          body: null,
        } as unknown as Response;
      }
      if (url.includes("/api/auth/login")) {
        await loginPromise;
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
          text: async () => "",
          headers: new Headers(),
          body: null,
        } as unknown as Response;
      }
      throw new Error(`Unmocked fetch: ${url}`);
    });
    globalThis.fetch = fn as unknown as typeof fetch;

    await user.type(screen.getByPlaceholderText("PIN"), "1234");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Use passkey" })).toBeDisabled();
    expect(fn.mock.calls.filter((c) => String(c[0]).includes("/api/auth/login"))).toHaveLength(1);

    await act(async () => {
      resolveLogin({});
    });
    await waitFor(() => expect(loc.href).toBe("/"));
  });

  it("completes the passkey path and routes home", async () => {
    const user = userEvent.setup();
    await readyWithAccounts([ACCOUNTS[0]]);
    const { calls } = mockFetch([
      { match: "/api/auth/me", body: { user: null, hasUsers: true, accounts: [ACCOUNTS[0]] } },
      {
        match: "/api/auth/passkey/authenticate/begin",
        body: { options: { challenge: "ch" } },
      },
      { match: "/api/auth/passkey/authenticate/complete", body: { ok: true } },
    ]);
    await user.click(screen.getByRole("button", { name: "Use passkey" }));
    await waitFor(() => expect(loc.href).toBe("/"));
    expect(startAuthentication).toHaveBeenCalledWith({ challenge: "ch" });
    const begin = calls.find((c) => c.url.includes("/passkey/authenticate/begin"));
    expect(JSON.parse(String(begin?.init?.body))).toEqual({ userId: "u1" });
    const complete = calls.find((c) => c.url.includes("/passkey/authenticate/complete"));
    expect(JSON.parse(String(complete?.init?.body))).toEqual({
      userId: "u1",
      assertion: { id: "assertion-1", response: {} },
    });
  });

  it("surfaces a passkey error without navigating", async () => {
    const user = userEvent.setup();
    await readyWithAccounts([ACCOUNTS[0]]);
    startAuthentication.mockRejectedValueOnce(new Error("cancelled"));
    mockFetch([
      { match: "/api/auth/me", body: { user: null, hasUsers: true, accounts: [ACCOUNTS[0]] } },
      { match: "/api/auth/passkey/authenticate/begin", body: { options: { challenge: "ch" } } },
    ]);
    await user.click(screen.getByRole("button", { name: "Use passkey" }));
    await waitFor(() => expect(screen.getByText("cancelled")).toBeInTheDocument());
    expect(loc.href).toBe("http://localhost/login");
  });
});
