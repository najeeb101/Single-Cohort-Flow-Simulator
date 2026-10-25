"use client";

import { useEffect, useState } from "react";

// Mirrors the inline anti-flash script in layout.tsx: that script is the only thing
// that runs before paint, this component is the only thing that runs after — both
// agree on the same class name and localStorage key.
// Rendered as a row in the sidebar (AppShell); `className` comes from there.
export default function ThemeToggle({ className, showLabel = true }: { className?: string; showLabel?: boolean }) {
  const [light, setLight] = useState(true);

  useEffect(() => {
    // One-time sync from the DOM class the pre-paint script (layout.tsx) already set. Done after
    // mount rather than as a lazy initializer on purpose: reading `document` during render would
    // cause an SSR/client hydration mismatch. The rule's "avoid setState in effect" doesn't fit here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLight(!document.documentElement.classList.contains("theme-dark"));
  }, []);

  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("theme-dark", !next);
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
      title={light ? "Switch to dark mode" : "Switch to light mode"}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      className={className}
    >
      {light ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="shrink-0" aria-hidden>
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8" />
        </svg>
      )}
      {showLabel && <span className="truncate">{light ? "Dark mode" : "Light mode"}</span>}
    </button>
  );
}
