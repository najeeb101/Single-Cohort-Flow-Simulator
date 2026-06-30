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
  { href: "/live", label: "Live" },
];

const GROUPS: { label: string; links: NavLink[] }[] = [
  {
    label: "Analytics",
    links: [
      { href: "/cohorts", label: "Cohorts" },
      { href: "/bottlenecks", label: "Bottlenecks" },
      { href: "/figures", label: "Figures" },
      { href: "/prerequisites", label: "Prerequisites" },
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
            ? "whitespace-nowrap border-b-2 border-accent px-3 py-3 text-[13px] font-semibold text-ink"
            : "whitespace-nowrap border-b-2 border-transparent px-3 py-3 text-[13px] font-semibold text-muted hover:text-ink"
        }
      >
        {label} <span className="text-[10px]">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 min-w-[170px] rounded-[9px] border border-border-2 bg-surface py-1.5 shadow-lg">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block px-3.5 py-2 text-[13px] font-semibold text-muted hover:bg-surface-2 hover:text-ink"
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

  return (
    <nav className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1600px] items-center gap-1 px-7">
        {PRIMARY_LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={
                active
                  ? "whitespace-nowrap border-b-2 border-accent px-3 py-3 text-[13px] font-semibold text-ink"
                  : "whitespace-nowrap border-b-2 border-transparent px-3 py-3 text-[13px] font-semibold text-muted hover:text-ink"
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
              ? "whitespace-nowrap border-b-2 border-accent px-3 py-3 text-[13px] font-semibold text-ink"
              : "whitespace-nowrap border-b-2 border-transparent px-3 py-3 text-[13px] font-semibold text-muted hover:text-ink"
          }
        >
          {SETTINGS_LINK.label}
        </Link>
        <div className="ml-auto flex items-center py-3">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
