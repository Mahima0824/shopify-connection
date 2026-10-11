import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useScrollToTop } from "../src/hooks/useScrollToTop";
import { ScrollToTop } from "../src/components/ScrollToTop";

describe("useScrollToTop Hook", () => {
  let scrollToSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollToSpy = vi.fn();
    window.scrollTo = scrollToSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("provides scrollToTop helper and scrolls to top 0", () => {
    function TestComponent() {
      const { scrollToTop } = useScrollToTop();
      return (
        <button onClick={() => scrollToTop("smooth")} data-testid="scroll-btn">
          Scroll
        </button>
      );
    }

    render(<TestComponent />);
    fireEvent.click(screen.getByTestId("scroll-btn"));

    expect(scrollToSpy).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: "smooth",
    });
  });

  it("updates isVisible when window scrolls past threshold", () => {
    function TestComponent() {
      const { isVisible, scrollY } = useScrollToTop({ threshold: 200 });
      return (
        <div>
          <span data-testid="visible">{isVisible ? "yes" : "no"}</span>
          <span data-testid="pos">{scrollY}</span>
        </div>
      );
    }

    render(<TestComponent />);
    expect(screen.getByTestId("visible").textContent).toBe("no");

    // Simulate scroll past threshold
    act(() => {
      Object.defineProperty(window, "scrollY", { value: 350, writable: true });
      fireEvent.scroll(window);
    });

    // Request animation frame trigger
    expect(window.scrollY).toBe(350);
  });
});

describe("ScrollToTop Component", () => {
  let scrollToSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollToSpy = vi.fn();
    window.scrollTo = scrollToSpy;
  });

  it("resets scroll position to 0 on route navigation", () => {
    function NavTestComponent() {
      const navigate = useNavigate();
      return (
        <div>
          <ScrollToTop showButton={false} />
          <button onClick={() => navigate("/new-page")} data-testid="navigate-btn">
            Navigate
          </button>
        </div>
      );
    }

    render(
      <MemoryRouter initialEntries={["/initial"]}>
        <NavTestComponent />
      </MemoryRouter>
    );

    // Initial mount call
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" });

    // Navigate to another route
    fireEvent.click(screen.getByTestId("navigate-btn"));
    expect(scrollToSpy).toHaveBeenCalledTimes(2);
  });

  it("renders button when threshold is 0 and triggers smooth scroll on click", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <ScrollToTop showButton={true} threshold={-1} />
      </MemoryRouter>
    );

    const btn = screen.getByRole("button", { name: /scroll to top/i });
    expect(btn).toBeTruthy();

    fireEvent.click(btn);
    expect(scrollToSpy).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: "smooth",
    });
  });
});
