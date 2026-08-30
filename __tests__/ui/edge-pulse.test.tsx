import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { EdgePulse } from "@/components/edge-pulse";

/**
 * EdgePulse is purely decorative but sits on the click path of every button,
 * so these tests are really latency guards: it must render nothing when idle,
 * never block a click, cap the number of live pulses, and honor reduced motion.
 */

const RAF_DELAY = 16;

function pulseTarget(label = "Act", attrs: Record<string, string> = {}) {
  const btn = document.createElement("button");
  btn.textContent = label;
  Object.entries(attrs).forEach(([k, v]) => btn.setAttribute(k, v));
  // jsdom reports a zero rect; EdgePulse skips anything under 4px.
  btn.getBoundingClientRect = () =>
    ({ width: 120, height: 36, left: 10, top: 20, right: 130, bottom: 56, x: 10, y: 20 }) as DOMRect;
  document.body.appendChild(btn);
  return btn;
}

function setReducedMotion(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("edge pulse", () => {
  beforeEach(() => {
    setReducedMotion(false);
    // rAF is faked alongside timers so frames advance deterministically.
    // `performance` is deliberately left real: the 80ms click throttle compares
    // against performance.now(), which a faked clock would pin to 0 and swallow.
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function flushFrames(ms = RAF_DELAY * 2) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  function click(el: HTMLElement) {
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("renders nothing while idle", () => {
    render(<EdgePulse />);
    expect(document.querySelector("svg")).toBeNull();
  });

  it("traces a pulse after a click, on the next frame rather than inline", () => {
    render(<EdgePulse />);
    const btn = pulseTarget();
    click(btn);
    expect(document.querySelector("svg")).toBeNull();
    flushFrames();
    expect(document.querySelector("svg")).not.toBeNull();
    expect(document.querySelectorAll("path.lm-edge-stroke").length).toBeGreaterThan(0);
  });

  it("hides the overlay from assistive tech", () => {
    render(<EdgePulse />);
    click(pulseTarget());
    flushFrames();
    expect(document.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("does nothing at all when the user prefers reduced motion", () => {
    setReducedMotion(true);
    render(<EdgePulse />);
    click(pulseTarget());
    flushFrames();
    expect(document.querySelector("svg")).toBeNull();
  });

  it("ignores disabled controls and text inputs", () => {
    render(<EdgePulse />);
    const disabled = pulseTarget("Disabled");
    disabled.setAttribute("disabled", "");
    click(disabled);
    flushFrames();
    expect(document.querySelector("svg")).toBeNull();

    const input = document.createElement("input");
    document.body.appendChild(input);
    click(input);
    flushFrames();
    expect(document.querySelector("svg")).toBeNull();
  });

  it("respects an explicit data-pulse=false opt-out", () => {
    render(<EdgePulse />);
    click(pulseTarget("Opted out", { "data-pulse": "false" }));
    flushFrames();
    expect(document.querySelector("svg")).toBeNull();
  });

  it("throttles bursts of clicks", () => {
    render(<EdgePulse />);
    const btn = pulseTarget();
    click(btn);
    click(btn);
    click(btn);
    flushFrames();
    // The 80ms floor collapses the burst into a single trace.
    expect(document.querySelectorAll("g").length).toBe(1);
  });

  it("caps concurrent pulses at three", () => {
    render(<EdgePulse />);
    const btn = pulseTarget();
    for (let i = 0; i < 6; i += 1) {
      click(btn);
      flushFrames(100);
    }
    expect(document.querySelectorAll("g").length).toBeLessThanOrEqual(3);
  });

  it("retires a pulse once its animation is over", () => {
    render(<EdgePulse />);
    click(pulseTarget());
    flushFrames();
    expect(document.querySelector("svg")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(document.querySelector("svg")).toBeNull();
  });

  it("drops the click listener on unmount", () => {
    const { unmount } = render(<EdgePulse />);
    const remove = vi.spyOn(document, "removeEventListener");
    unmount();
    expect(remove).toHaveBeenCalledWith("click", expect.any(Function), expect.anything());
    remove.mockRestore();
  });

  it("traces controls that only opt in via role", () => {
    render(<EdgePulse />);
    const row = document.createElement("div");
    row.setAttribute("role", "button");
    row.textContent = "Row";
    row.getBoundingClientRect = () =>
      ({ width: 200, height: 40, left: 0, top: 0, right: 200, bottom: 40, x: 0, y: 0 }) as DOMRect;
    document.body.appendChild(row);
    click(row);
    flushFrames();
    expect(document.querySelector("svg")).not.toBeNull();
  });

  it("keeps the click handler off the measurement path", () => {
    render(<EdgePulse />);
    const btn = pulseTarget();
    const measure = vi.spyOn(btn, "getBoundingClientRect");
    click(btn);
    // Nothing is measured synchronously; that work waits for the frame.
    expect(measure).not.toHaveBeenCalled();
    flushFrames();
    expect(measure).toHaveBeenCalled();
    measure.mockRestore();
  });
});

describe("deferred shell", () => {
  beforeEach(() => {
    setReducedMotion(false);
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("keeps decorative shell features off the first paint", async () => {
    const { DeferredShell } = await import("@/components/deferred-shell");
    render(<DeferredShell />);
    // Nothing decorative is in the tree yet; the palette arrives on idle.
    expect(document.querySelector("svg")).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
