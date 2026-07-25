"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Sticky-bottom chat scroll that follows new content only while the user is
 * already near the bottom. Scrolling up to read pauses follow; returning near
 * the bottom (or sending a new message) resumes it.
 *
 * During streaming we snap on the next animation frame — stacking
 * `behavior: "smooth"` on every token is what makes chat feel jumpy.
 */

const NEAR_BOTTOM_PX = 96;

export function useStickyThreadScroll() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const rafRef = useRef(0);
  const userScrollingRef = useRef(false);
  const userScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const distanceFromBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return 0;
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // While a programmatic scrollIntoView(smooth) is in flight, don't treat
    // the intermediate positions as the user scrolling away.
    if (userScrollingRef.current) return;
    stickRef.current = distanceFromBottom() <= NEAR_BOTTOM_PX;
  }, [distanceFromBottom]);

  const scrollToBottom = useCallback(
    (opts?: { force?: boolean; smooth?: boolean }) => {
      const el = scrollerRef.current;
      if (!el) return;
      if (opts?.force) stickRef.current = true;
      if (!stickRef.current) return;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const node = bottomRef.current;
        if (opts?.smooth && node) {
          userScrollingRef.current = true;
          if (userScrollTimer.current) clearTimeout(userScrollTimer.current);
          node.scrollIntoView({ behavior: "smooth", block: "end" });
          userScrollTimer.current = setTimeout(() => {
            userScrollingRef.current = false;
            stickRef.current = distanceFromBottom() <= NEAR_BOTTOM_PX;
          }, 350);
          return;
        }
        // Instant snap — used while tokens arrive so we don't queue animations.
        el.scrollTop = el.scrollHeight;
      });
    },
    [distanceFromBottom]
  );

  const lockFollow = useCallback(() => {
    stickRef.current = true;
  }, []);

  const isFollowing = useCallback(() => stickRef.current, []);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (userScrollTimer.current) clearTimeout(userScrollTimer.current);
    },
    []
  );

  return {
    scrollerRef,
    bottomRef,
    onScroll,
    scrollToBottom,
    lockFollow,
    isFollowing,
  };
}
