"use client";

import { Moon, Sun } from "@phosphor-icons/react";

export function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const current = root.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("plimsoll-theme", next);
    } catch {
      /* private mode: theme still applies for this page view */
    }
  };
  return (
    <button type="button" className="btn ghost sm theme-toggle" onClick={toggle} aria-label="Toggle light or dark theme">
      <Sun className="theme-sun" aria-hidden />
      <Moon className="theme-moon" aria-hidden />
    </button>
  );
}
