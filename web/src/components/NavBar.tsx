"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/scenario-builder", label: "Scenario Builder" },
  { href: "/cohorts", label: "Cohorts" },
  { href: "/bottlenecks", label: "Bottlenecks" },
  { href: "/figures", label: "Figures" },
  { href: "/prerequisites", label: "Prerequisites" },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-7">
        {LINKS.map((link) => {
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
      </div>
    </nav>
  );
}
