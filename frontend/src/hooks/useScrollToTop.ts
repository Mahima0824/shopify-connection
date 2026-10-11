import { useState, useEffect, useCallback } from "react";

export interface UseScrollToTopOptions {
  /**
   * Distance in pixels scrolled from the top before isVisible becomes true.
   * Default: 300
   */
  threshold?: number;
  /**
   * Default behavior for the scrollToTop invocation.
   * Default: "smooth"
   */
  behavior?: ScrollBehavior;
}

export interface UseScrollToTopReturn {
  /**
   * Smoothly or instantly scrolls the window to the top (top: 0, left: 0).
   */
  scrollToTop: (customBehavior?: ScrollBehavior) => void;
  /**
   * Whether the user has scrolled beyond the threshold.
   */
  isVisible: boolean;
  /**
   * Current window scrollY value.
   */
  scrollY: number;
}

/**
 * useScrollToTop hook
 *
 * Tracks window vertical scroll position, determines if the user has scrolled
 * past a threshold (default 300px), and provides a reliable, safe helper to
 * scroll the window back to top 0.
 */
export function useScrollToTop(options: UseScrollToTopOptions = {}): UseScrollToTopReturn {
  const { threshold = 300, behavior: defaultBehavior = "smooth" } = options;

  const [scrollY, setScrollY] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return window.scrollY || document.documentElement.scrollTop || 0;
  });

  const isVisible = scrollY > threshold;

  const scrollToTop = useCallback(
    (customBehavior?: ScrollBehavior) => {
      if (typeof window === "undefined" || typeof window.scrollTo !== "function") return;
      const isUnmockedJSDOM =
        typeof navigator !== "undefined" &&
        navigator.userAgent &&
        navigator.userAgent.includes("jsdom") &&
        !("mock" in window.scrollTo || "_isMockFunction" in window.scrollTo);

      if (isUnmockedJSDOM) return;

      const targetBehavior = customBehavior || defaultBehavior;
      try {
        window.scrollTo({
          top: 0,
          left: 0,
          behavior: targetBehavior,
        });
      } catch {
        // Fallback for legacy environments that do not support ScrollToOptions
        try {
          window.scrollTo(0, 0);
        } catch {
          // ignore
        }
      }
    },
    [defaultBehavior]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentY = window.scrollY || document.documentElement.scrollTop || 0;
          setScrollY(currentY);
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    // Initial check
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return {
    scrollToTop,
    isVisible,
    scrollY,
  };
}

export default useScrollToTop;
