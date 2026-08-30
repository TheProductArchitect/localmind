import { vi } from "vitest";

/**
 * Shared harness for component tests: Next.js navigation stubs, a fetch stub
 * that answers by URL, and matchMedia/rAF shims jsdom does not provide.
 */

export const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

let pathname = "/";
let searchParams = new URLSearchParams();

/**
 * Points both the mocked router hooks and jsdom's own URL at `path?query` —
 * components read either one (some build their route from window.location).
 */
export function setRoute(path: string, query = "") {
  pathname = path;
  searchParams = new URLSearchParams(query);
  if (typeof window !== "undefined") {
    const suffix = query ? `?${query.replace(/^\?/, "")}` : "";
    window.history.replaceState({}, "", `${path}${suffix}`);
  }
}

/**
 * Call at module scope of a test file (vi.mock is hoisted, so it must be
 * invoked as `mockNextNavigation()` inside a `vi.mock` factory-free helper).
 */
export function nextNavigationMock() {
  return {
    useRouter: () => routerMock,
    usePathname: () => pathname,
    useSearchParams: () => searchParams,
    redirect: vi.fn(),
    notFound: vi.fn(),
  };
}

/**
 * Response body: either a literal or a function of the request. Spelled out as
 * a union of concrete shapes because `unknown | fn` collapses to `unknown`,
 * which would erase the callback's parameter type at every call site.
 */
export type FetchBody =
  | ((init: RequestInit | undefined) => unknown)
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

export type FetchRoute = {
  match: RegExp | string;
  body: FetchBody;
  status?: number;
};

/**
 * Installs a `fetch` that resolves the first matching route and records calls.
 * Unmatched URLs reject loudly so a test can never silently pass on a typo.
 */
export function mockFetch(routes: FetchRoute[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push({ url, init });
    const route = routes.find((r) =>
      typeof r.match === "string" ? url.includes(r.match) : r.match.test(url)
    );
    if (!route) throw new Error(`Unmocked fetch: ${url}`);
    const body = typeof route.body === "function" ? route.body(init) : route.body;
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
      text: async () => JSON.stringify(body),
      body: null,
    } as unknown as Response;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return { fn, calls };
}

/** jsdom gaps that components touch on mount. */
export function installBrowserShims() {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }
  if (!window.requestIdleCallback) {
    window.requestIdleCallback = ((cb: IdleRequestCallback) =>
      window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0)) as never;
    window.cancelIdleCallback = ((id: number) => clearTimeout(id)) as never;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  if (!window.HTMLElement.prototype.scrollTo) {
    window.HTMLElement.prototype.scrollTo = vi.fn();
  }
}
