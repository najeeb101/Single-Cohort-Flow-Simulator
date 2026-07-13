"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

type NavLink = { href: string; label: string };

// Top-level items stay as direct links; everything else groups into a dropdown so the bar
// doesn't overflow into horizontal scroll. Grouping is by what the page is *for*, not just
// alphabetical: Analytics = different lenses on the same simulation result, Plans = managing
// reusable configs (scenarios/curricula) rather than viewing output.
const PRIMARY_LINKS: NavLink[] = [
  { href: "/", label: "Dashboard" },
  { href: "/bottlenecks", label: "Bottlenecks" },
  { href: "/live", label: "Live" },
];

const GROUPS: { label: string; links: NavLink[] }[] = [
  {
    label: "Analytics",
    links: [
      { href: "/advisor", label: "Advisor" },
      { href: "/students", label: "Student Trace" },
      { href: "/figures", label: "Figures" },
    ],
  },
  {
    label: "Plans",
    links: [
      { href: "/plans", label: "Plans" },
      { href: "/plan-builder", label: "Plan Builder" },
      { href: "/runs", label: "Run History" },
    ],
  },
];

const SETTINGS_LINK: NavLink = { href: "/settings", label: "Settings" };

function NavDropdown({ label, links, active }: { label: string; links: NavLink[]; active: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          active
            ? "whitespace-nowrap border-b-2 border-accent px-3 py-3 text-sm font-semibold text-ink"
            : "whitespace-nowrap border-b-2 border-transparent px-3 py-3 text-sm font-semibold text-muted hover:text-ink"
        }
      >
        {label} <span className="text-[10px]">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 min-w-[170px] rounded-xl border border-border-2 bg-surface py-1.5 shadow-lg">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block px-3.5 py-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NavBar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Each mobile link closes the menu via its own onClick, so no route-change effect is needed.
  const mobileLinks = [...PRIMARY_LINKS, ...GROUPS.flatMap((g) => g.links), SETTINGS_LINK];

  return (
    <nav className="border-b border-border bg-surface/85 backdrop-blur-md sticky top-0 z-50">
      <div className="mx-auto grid max-w-[1600px] grid-cols-[1fr_auto_1fr] items-center px-7">
        <Link href="/" className="flex items-center gap-2" aria-label="Cohort Analyzer home">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-maroon text-xs font-extrabold text-white">
            CA
          </span>
        </Link>
        {/* Desktop nav: the full bar. Below md it collapses into the hamburger menu below. */}
        <div className="hidden items-center justify-center gap-1 md:flex">
          {PRIMARY_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={
                  active
                    ? "whitespace-nowrap border-b-2 border-accent px-3 py-3 text-sm font-semibold text-ink"
                    : "whitespace-nowrap border-b-2 border-transparent px-3 py-3 text-sm font-semibold text-muted hover:text-ink"
                }
              >
                {link.label}
              </Link>
            );
          })}
          {GROUPS.map((group) => (
            <NavDropdown
              key={group.label}
              label={group.label}
              links={group.links}
              active={group.links.some((l) => l.href === pathname)}
            />
          ))}
          <Link
            href={SETTINGS_LINK.href}
            className={
              pathname === SETTINGS_LINK.href
                ? "whitespace-nowrap border-b-2 border-accent px-3 py-3 text-sm font-semibold text-ink"
                : "whitespace-nowrap border-b-2 border-transparent px-3 py-3 text-sm font-semibold text-muted hover:text-ink"
            }
          >
            {SETTINGS_LINK.label}
          </Link>
        </div>
        <div className="flex items-center justify-end gap-2 py-3">
          <Link
            href="/about"
            title="About this tool"
            aria-label="About this tool"
            className="grid h-8 w-8 place-items-center rounded-lg border border-border-2 bg-surface-2 text-sm font-bold text-ink transition-colors hover:bg-surface"
          >
            ?
          </Link>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileOpen}
            className="grid h-8 w-8 place-items-center rounded-lg border border-border-2 bg-surface-2 text-ink transition-colors hover:bg-surface md:hidden"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {mobileOpen ? (
                <path d="M6 6l12 12M6 18L18 6" />
              ) : (
                <>
                  <path d="M3 6h18" />
                  <path d="M3 12h18" />
                  <path d="M3 18h18" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu: full link list, shown only below md when the hamburger is open. */}
      {mobileOpen && (
        <div className="border-t border-border bg-surface md:hidden">
          <div className="mx-auto flex max-w-[1600px] flex-col px-5 py-2">
            {mobileLinks.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={
                    active
                      ? "rounded-lg bg-surface-2 px-3 py-2.5 text-sm font-semibold text-ink"
                      : "rounded-lg px-3 py-2.5 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
                  }
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}
