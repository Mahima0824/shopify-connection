import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, beforeEach } from "vitest";
import { AppRoutes } from "../src/App";
import { ThemeProvider, ThemeToggle, useTheme } from "../src/context/ThemeContext";

function renderWithRouter(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>
  );
}

describe("ThemeContext & Dark Mode", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("defaults to light/system and toggles dark mode properly", () => {
    function TestComponent() {
      const { theme, resolvedTheme, toggleTheme, setTheme } = useTheme();
      return (
        <div>
          <span data-testid="theme">{theme}</span>
          <span data-testid="resolved">{resolvedTheme}</span>
          <button data-testid="toggle-btn" onClick={toggleTheme}>
            Toggle
          </button>
          <button data-testid="set-dark" onClick={() => setTheme("dark")}>
            Set Dark
          </button>
        </div>
      );
    }

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    // Toggle to dark
    fireEvent.click(screen.getByTestId("toggle-btn"));
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("recon_theme")).toBe("dark");

    // Toggle back to light
    fireEvent.click(screen.getByTestId("toggle-btn"));
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("recon_theme")).toBe("light");
  });

  it("ThemeToggle button switches aria-label and triggers toggle", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    const toggle = screen.getByRole("button", { name: /switch to dark mode/i });
    expect(toggle).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /switch to light mode/i })).toBeTruthy();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

describe("System Error & Status Pages", () => {
  it("renders 404 page for unknown routes with navigation links", () => {
    renderWithRouter("/this-route-does-not-exist");
    expect(screen.getByText(/404 · Page Not Located/i)).toBeTruthy();
    expect(screen.getByText(/Lost in Pipeline/i)).toBeTruthy();
    expect(screen.getAllByText(/Orders Directory/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Live Tracking/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders 500 Server Error page at /500", () => {
    renderWithRouter("/500");
    expect(screen.getByText(/500 · Server Discrepancy/i)).toBeTruthy();
    expect(screen.getByText(/Internal Processing Error/i)).toBeTruthy();
    expect(screen.getByText(/ERR-500-SRV-LIV-092/i)).toBeTruthy();
    expect(screen.getByText(/Retry Request/i)).toBeTruthy();
    expect(screen.getByText(/Return to Dashboard/i)).toBeTruthy();
  });

  it("renders 503 Maintenance page at /maintenance and /503", () => {
    const { unmount } = renderWithRouter("/maintenance");
    expect(screen.getByText(/503 · Platform Maintenance/i)).toBeTruthy();
    expect(screen.getByText(/Scheduled Platform Upgrade/i)).toBeTruthy();
    expect(screen.getByText(/Check Status/i)).toBeTruthy();
    expect(screen.getByText(/Shopify orders are safely queued/i)).toBeTruthy();
    unmount();

    renderWithRouter("/503");
    expect(screen.getByText(/503 · Platform Maintenance/i)).toBeTruthy();
    expect(screen.getByText(/Scheduled Platform Upgrade/i)).toBeTruthy();
  });
});
