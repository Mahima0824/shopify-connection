import React, { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useScrollToTop } from "../hooks/useScrollToTop";
import { Button } from "./primitives";
import { IconArrowUp } from "./icons";
import { cn } from "@/lib/utils";

/**
 * ScrollToTop component
 *
 * 1. Automatically scrolls window to top 0 on route changes.
 * 2. Renders an unobtrusive floating button when user scrolls down past 300px.
 */
export function ScrollToTop({
  showButton = true,
  threshold = 300,
  className,
}: {
  showButton?: boolean;
  threshold?: number;
  className?: string;
}) {
  const { pathname } = useLocation();
  const { isVisible, scrollToTop } = useScrollToTop({ threshold, behavior: "smooth" });

  // Automatically reset scroll to top 0 whenever route changes
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.scrollTo !== "function") return;
    const isUnmockedJSDOM =
      typeof navigator !== "undefined" &&
      navigator.userAgent &&
      navigator.userAgent.includes("jsdom") &&
      !("mock" in window.scrollTo || "_isMockFunction" in window.scrollTo);

    if (isUnmockedJSDOM) return;

    try {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    } catch {
      try {
        window.scrollTo(0, 0);
      } catch {
        // ignore
      }
    }
  }, [pathname]);

  if (!showButton || !isVisible) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-40 transition-all duration-300 ease-in-out animate-in fade-in zoom-in-95",
        className
      )}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => scrollToTop("smooth")}
        aria-label="Scroll to top"
        className="h-9 w-9 rounded-full shadow-lg border-border/80 bg-card/90 backdrop-blur-md hover:bg-muted text-foreground transition-transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
      >
        <IconArrowUp size={15} />
      </Button>
    </div>
  );
}

export default ScrollToTop;
