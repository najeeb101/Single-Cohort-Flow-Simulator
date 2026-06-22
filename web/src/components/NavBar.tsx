"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/scenario-builder", label: "Scenario Builder" },
  { href: "/cohorts", label: "Cohorts" },
  { href: "/bottlenecks", label: "Bottlenecks" },
  { href: "/figures", label: "Figures" },
  { href: "/prerequisites", label: "Prerequisites" },
  { href: "/scenarios", label: "Scenarios" },
  { href: "/plans", label: "Plans" },
  { href: "/plan-builder", label: "Plan Builder" },
  { href: "/runs", label: "Run History" },
  { href: "/settings", label: "Settings" },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => setEmail(data.authenticated ? data.email : null))
      .catch(() => setEmail(null));
  }, []);

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  return (
    <nav className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1600px] items-center gap-1 overflow-x-auto px-7">
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
        <div className="ml-auto flex items-center gap-3 whitespace-nowrap py-3 text-[12.5px] text-muted">
          {email && (
            <>
              <span>Signed in as {email}</span>
              <button type="button" onClick={signOut} className="font-semibold text-accent">
                Sign out
              </button>
            </>
          )}
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
