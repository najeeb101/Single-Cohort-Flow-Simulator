"use client";

import { useEffect, useState } from "react";

// Mirrors the inline anti-flash script in layout.tsx: that script is the only thing
// that runs before paint, this component is the only thing that runs after — both
// agree on the same class name and localStorage key.
export default function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.classList.contains("theme-light"));
  }, []);

  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("theme-light", next);
    try {
      localStorage.setItem("theme", next ? "light" : "dark");
    } catch {
      // localStorage unavailable (private browsing, etc.) — theme just won't persist.
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={light ? "Switch to dark theme" : "Switch to light theme"}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      className="grid h-8 w-8 place-items-center rounded-[8px] border border-border-2 bg-surface-2 text-ink transition-colors hover:bg-surface"
    >
      {light ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8" />
        </svg>
      )}
    </button>
  );
}
