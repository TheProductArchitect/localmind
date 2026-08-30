import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { nextNavigationMock, setRoute, mockFetch, installBrowserShims } from "../helpers/ui";

vi.mock("next/navigation", () => nextNavigationMock());

vi.mock("@/components/toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/note-graph", () => ({ NoteGraph: () => null }));
vi.mock("@/components/context-graph-view", () => ({ ContextGraphView: () => null }));
vi.mock("@/components/browse/sora-panel", () => ({
  BrowseSoraPanel: () => <div data-testid="sora-panel" />,
}));
vi.mock("@/components/orb", () => ({
  Orb: () => <div data-testid="orb" />,
}));

import KnowledgePage from "@/app/knowledge/page";
import ProjectsPage from "@/app/projects/page";
import DataPage from "@/app/data/page";
import { AppBrowser } from "@/components/browse/app-browser";

const NOTES = [
  { id: "n1", title: "Alpha note", content: "a" },
  { id: "n2", title: "Beta note", content: "b" },
];

const PROJECTS = [
  {
    id: "p1",
    name: "LocalMind",
    repo_path: "/repos/localmind",
    default_branch: "main",
    remote_url: null,
    github_owner: null,
    github_repo: null,
  },
  {
    id: "p2",
    name: "Other",
    repo_path: "/repos/other",
    default_branch: "main",
    remote_url: null,
    github_owner: null,
    github_repo: null,
  },
];

const TABLES = [
  { table_name: "expenses", schema_json: "[]", row_count: 3, updated_at: 1_700_000_000_000 },
  { table_name: "contacts", schema_json: "[]", row_count: 1, updated_at: 1_700_000_100_000 },
];

function installResizeObserver() {
  if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}

function installEventSource() {
  (globalThis as { EventSource: unknown }).EventSource = class {
    addEventListener() {}
    close() {}
    onerror: ((e: unknown) => void) | null = null;
  };
}

/** Keyboard/mouse activation for accessible list rows and browse tabs. */
describe("accessible list rows", () => {
  beforeEach(() => {
    installBrowserShims();
    installResizeObserver();
    installEventSource();
    vi.stubGlobal("open", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as { lmBrowser?: unknown }).lmBrowser;
  });

  describe("knowledge notes", () => {
    beforeEach(() => {
      setRoute("/knowledge", "tab=notes");
      mockFetch([{ match: "/api/knowledge/notes", body: { notes: NOTES } }]);
    });

    function noteRow(title: string) {
      // Nested delete button also matches /title/; the row name is exact.
      return screen.getByRole("button", { name: title });
    }

    async function notesReady() {
      render(<KnowledgePage />);
      await waitFor(() => expect(noteRow("Alpha note")).toBeInTheDocument());
    }

    it("activates a note on click and exposes aria-current", async () => {
      const user = userEvent.setup();
      await notesReady();
      const alpha = noteRow("Alpha note");
      await user.click(alpha);
      expect(alpha).toHaveAttribute("aria-current", "true");
      expect(screen.getByDisplayValue("Alpha note")).toBeInTheDocument();
      expect(noteRow("Beta note")).not.toHaveAttribute("aria-current");
    });

    it("activates a note on Enter and Space", async () => {
      const user = userEvent.setup();
      await notesReady();
      const beta = noteRow("Beta note");
      beta.focus();
      await user.keyboard("{Enter}");
      expect(beta).toHaveAttribute("aria-current", "true");
      expect(screen.getByDisplayValue("Beta note")).toBeInTheDocument();

      const alpha = noteRow("Alpha note");
      alpha.focus();
      await user.keyboard(" ");
      expect(alpha).toHaveAttribute("aria-current", "true");
      expect(screen.getByDisplayValue("Alpha note")).toBeInTheDocument();
    });

    it("does not select the note when its delete control is used", async () => {
      const user = userEvent.setup();
      const { calls } = mockFetch([
        { match: "/api/knowledge/notes", body: { notes: NOTES } },
        { match: /\/api\/knowledge\/notes\/n2$/, body: { ok: true } },
      ]);
      await notesReady();
      await user.click(noteRow("Alpha note"));
      expect(noteRow("Alpha note")).toHaveAttribute("aria-current", "true");

      await user.click(screen.getByRole("button", { name: "Delete Beta note" }));
      await waitFor(() =>
        expect(calls.some((c) => c.url.includes("/notes/n2") && c.init?.method === "DELETE")).toBe(true)
      );
      expect(noteRow("Alpha note")).toHaveAttribute("aria-current", "true");
      expect(screen.getByDisplayValue("Alpha note")).toBeInTheDocument();
    });
  });

  describe("projects", () => {
    beforeEach(() => {
      setRoute("/projects");
      mockFetch([
        { match: "/api/coding/projects", body: { projects: PROJECTS, sessions: [] } },
        { match: "/api/settings", body: { settings: {} } },
        { match: "/api/coding/open-window", body: { ok: true } },
      ]);
    });

    async function projectsReady() {
      render(<ProjectsPage />);
      await waitFor(() => expect(screen.getByRole("button", { name: /LocalMind/ })).toBeInTheDocument());
    }

    it("selects a project on click with aria-current", async () => {
      const user = userEvent.setup();
      await projectsReady();
      const other = screen.getByRole("button", { name: /Other/ });
      await user.click(other);
      await waitFor(() => expect(other).toHaveAttribute("aria-current", "true"));
      expect(screen.getByRole("button", { name: /LocalMind/ })).not.toHaveAttribute("aria-current");
    });

    it("selects a project on Enter and Space", async () => {
      const user = userEvent.setup();
      await projectsReady();
      const other = screen.getByRole("button", { name: /Other/ });
      other.focus();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(other).toHaveAttribute("aria-current", "true"));

      const lm = screen.getByRole("button", { name: /LocalMind/ });
      lm.focus();
      await user.keyboard(" ");
      await waitFor(() => expect(lm).toHaveAttribute("aria-current", "true"));
    });

    it("does not change selection when Open window is clicked", async () => {
      const user = userEvent.setup();
      const { calls } = mockFetch([
        { match: "/api/coding/projects", body: { projects: PROJECTS, sessions: [] } },
        { match: "/api/settings", body: { settings: {} } },
        { match: "/api/coding/open-window", body: { ok: true } },
      ]);
      await projectsReady();
      const lm = screen.getByRole("button", { name: /LocalMind/ });
      await waitFor(() => expect(lm).toHaveAttribute("aria-current", "true"));

      const other = screen.getByRole("button", { name: /Other/ });
      const openBtn = within(other).getByRole("button", { name: "Open window" });
      await user.click(openBtn);

      await waitFor(() =>
        expect(calls.some((c) => c.url.includes("/api/coding/open-window"))).toBe(true)
      );
      const open = calls.find((c) => c.url.includes("/api/coding/open-window"));
      expect(JSON.parse(String(open?.init?.body))).toEqual({ project_id: "p2" });
      expect(lm).toHaveAttribute("aria-current", "true");
      expect(other).not.toHaveAttribute("aria-current");
    });
  });

  describe("data tables", () => {
    beforeEach(() => {
      setRoute("/data");
      mockFetch([
        { match: "/api/data/tables", body: { tables: TABLES } },
        { match: "/api/data/spreadsheets", body: { spreadsheets: [] } },
        {
          match: /\/api\/data\/tables\//,
          body: { records: [{ record_id: "r1", data_json: "{\"a\":1}", created_at: 1 }] },
        },
      ]);
    });

    async function tablesReady() {
      render(<DataPage />);
      await waitFor(() => expect(screen.getByRole("button", { name: /expenses/ })).toBeInTheDocument());
    }

    it("opens a table on click and sets aria-current", async () => {
      const user = userEvent.setup();
      await tablesReady();
      const expenses = screen.getByRole("button", { name: /expenses/ });
      await user.click(expenses);
      await waitFor(() => expect(screen.getByText(/expenses — last/)).toBeInTheDocument());
      expect(expenses).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("button", { name: /contacts/ })).not.toHaveAttribute("aria-current");
    });

    it("opens a table on Enter and Space", async () => {
      const user = userEvent.setup();
      await tablesReady();
      const contacts = screen.getByRole("button", { name: /contacts/ });
      contacts.focus();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(screen.getByText(/contacts — last/)).toBeInTheDocument());
      expect(contacts).toHaveAttribute("aria-current", "true");

      await user.click(screen.getByRole("button", { name: "Close" }));
      const expenses = screen.getByRole("button", { name: /expenses/ });
      expenses.focus();
      await user.keyboard(" ");
      await waitFor(() => expect(screen.getByText(/expenses — last/)).toBeInTheDocument());
      expect(expenses).toHaveAttribute("aria-current", "true");
    });
  });

  describe("browse tab strip", () => {
    function installLmBrowser(initial?: {
      activeTabId: number | null;
      tabs: {
        id: number;
        url: string;
        title: string;
        loading: boolean;
        canGoBack: boolean;
        canGoForward: boolean;
      }[];
    }) {
      let state = initial ?? {
        activeTabId: 1,
        tabs: [
          {
            id: 1,
            url: "https://example.com",
            title: "Example",
            loading: false,
            canGoBack: false,
            canGoForward: false,
          },
          {
            id: 2,
            url: "https://other.test",
            title: "Other",
            loading: false,
            canGoBack: false,
            canGoForward: false,
          },
        ],
      };
      const listeners = new Set<(s: typeof state) => void>();
      const lm = {
        newTab: vi.fn(async () => 3),
        closeTab: vi.fn(async (id: number) => {
          state = {
            ...state,
            tabs: state.tabs.filter((t) => t.id !== id),
            activeTabId: state.activeTabId === id ? state.tabs.find((t) => t.id !== id)?.id ?? null : state.activeTabId,
          };
          listeners.forEach((cb) => cb(state));
        }),
        selectTab: vi.fn(async (id: number) => {
          state = { ...state, activeTabId: id };
          listeners.forEach((cb) => cb(state));
        }),
        navigate: vi.fn(async () => {}),
        back: vi.fn(async () => {}),
        forward: vi.fn(async () => {}),
        reload: vi.fn(async () => {}),
        setBounds: vi.fn(async () => {}),
        setVisible: vi.fn(async () => {}),
        getState: vi.fn(async () => state),
        getTargetId: vi.fn(async () => "tid"),
        onState: vi.fn((cb: (s: typeof state) => void) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        }),
      };
      (window as { lmBrowser?: typeof lm }).lmBrowser = lm;
      mockFetch([{ match: "/api/conversations", body: { conversation: { id: "c1" } } }]);
      return lm;
    }

    it("selects a tab on click and exposes aria-selected", async () => {
      const user = userEvent.setup();
      const lm = installLmBrowser();
      render(<AppBrowser />);
      await waitFor(() => expect(screen.getByRole("tab", { name: /Example/ })).toBeInTheDocument());
      expect(screen.getByRole("tab", { name: /Example/ })).toHaveAttribute("aria-selected", "true");

      await user.click(screen.getByRole("tab", { name: /Other/ }));
      expect(lm.selectTab).toHaveBeenCalledWith(2);
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: /Other/ })).toHaveAttribute("aria-selected", "true")
      );
    });

    it("selects a tab on Enter and Space", async () => {
      const user = userEvent.setup();
      const lm = installLmBrowser();
      render(<AppBrowser />);
      await waitFor(() => expect(screen.getByRole("tab", { name: /Other/ })).toBeInTheDocument());

      const other = screen.getByRole("tab", { name: /Other/ });
      other.focus();
      await user.keyboard("{Enter}");
      expect(lm.selectTab).toHaveBeenCalledWith(2);

      const example = screen.getByRole("tab", { name: /Example/ });
      example.focus();
      await user.keyboard(" ");
      expect(lm.selectTab).toHaveBeenCalledWith(1);
    });

    it("does not select a tab when Close tab is clicked", async () => {
      const user = userEvent.setup();
      const lm = installLmBrowser();
      render(<AppBrowser />);
      await waitFor(() => expect(screen.getByRole("tab", { name: /Other/ })).toBeInTheDocument());

      lm.selectTab.mockClear();
      const other = screen.getByRole("tab", { name: /Other/ });
      await user.click(within(other).getByRole("button", { name: "Close tab" }));
      expect(lm.closeTab).toHaveBeenCalledWith(2);
      expect(lm.selectTab).not.toHaveBeenCalled();
      expect(screen.getByRole("tab", { name: /Example/ })).toHaveAttribute("aria-selected", "true");
    });
  });
});
