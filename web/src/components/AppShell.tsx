"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import { listPlans } from "@/lib/api";
import type { PlanRecord } from "@/types/simulation";

// The app frame, modelled on QU CoAdvisor: a deep maroon sidebar with the white QU mark and line
// icons, a thin notice strip on top, and the page itself in a rounded off-white panel inset into
// the maroon frame. Below lg the sidebar becomes a top bar with a slide-out menu.

type IconName = "planner" | "bottlenecks" | "walkthrough" | "advisor" | "data" | "plans" | "builder" | "method" | "collapse";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    planner: (
      <>
        <path d="M3 3v18h18" />
        <path d="m7 15 4-4 3 3 5-6" />
      </>
    ),
    bottlenecks: <path d="M3 4h18l-7 8.5V19l-4 2v-8.5z" />,
    walkthrough: (
      <>
        <circle cx="6" cy="6" r="2.2" />
        <circle cx="18" cy="18" r="2.2" />
        <path d="M8.2 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.8" />
      </>
    ),
    advisor: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z" />,
    data: (
      <>
        <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
        <path d="M4.5 5.5v6.5c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V5.5" />
        <path d="M4.5 12v6.5c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V12" />
      </>
    ),
    plans: (
      <>
        <path d="m12 3 9 5-9 5-9-5z" />
        <path d="m3 13 9 5 9-5" />
      </>
    ),
    builder: (
      <>
        <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
        <path d="M12 8v8M8 12h8" />
      </>
    ),
    method: (
      <>
        <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H11v18H5.5A2.5 2.5 0 0 1 3 18.5z" />
        <path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H13v18h5.5a2.5 2.5 0 0 0 2.5-2.5z" />
      </>
    ),
    collapse: (
      <>
        <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
        <path d="M9.5 4v16" />
      </>
    ),
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
      {paths[name]}
    </svg>
  );
}

type NavItem = { href: string; label: string; icon: IconName };

const MAIN: NavItem[] = [
  { href: "/", label: "Intake Planner", icon: "planner" },
  { href: "/bottlenecks", label: "Bottlenecks", icon: "bottlenecks" },
  { href: "/walkthrough", label: "Walkthrough", icon: "walkthrough" },
  { href: "/advisor", label: "Advisor", icon: "advisor" },
  { href: "/data", label: "Data", icon: "data" },
];

const PROGRAMS: NavItem[] = [
  { href: "/plans", label: "Plans", icon: "plans" },
  { href: "/plan-builder", label: "Plan Builder", icon: "builder" },
  { href: "/about", label: "Methodology", icon: "method" },
];

const COLLAPSED_KEY = "sidebar-collapsed";

const rowClass = (active: boolean, collapsed: boolean) =>
  `flex w-full items-center gap-3 rounded-lg py-2 text-[14px] ${collapsed ? "justify-center px-0" : "px-2.5"} ${
    active ? "bg-[var(--frame-active)] font-medium text-[var(--frame-ink)]" : "text-[var(--frame-muted)] hover:bg-[var(--frame-hover)] hover:text-[var(--frame-ink)]"
  }`;

function NavRows({ items, pathname, collapsed, onNavigate }: { items: NavItem[]; pathname: string; collapsed: boolean; onNavigate?: () => void }) {
  return (
    <>
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={rowClass(active, collapsed)}
          >
            <Icon name={item.icon} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </>
  );
}

// Which program (Plan) every page is working on, like CoAdvisor's profile card.
function ProgramCard({ plan, collapsed }: { plan: PlanRecord | null; collapsed: boolean }) {
  if (collapsed || !plan) return null;
  return (
    <div className="rounded-xl bg-[var(--frame-hover)] px-3 py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--frame-muted)]">Program</div>
      <div className="mt-0.5 truncate text-[13px] font-medium text-[var(--frame-ink)]" title={plan.name}>
        {plan.name}
      </div>
      <Link href="/plans" className="mt-1 inline-block text-[12px] text-[var(--frame-muted)] underline-offset-2 hover:text-[var(--frame-ink)] hover:underline">
        Switch program
      </Link>
    </div>
  );
}

function SidebarBody({
  pathname,
  collapsed,
  plan,
  onToggleCollapse,
  onNavigate,
}: {
  pathname: string;
  collapsed: boolean;
  plan: PlanRecord | null;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col px-3 pb-3 pt-4">
      <div className={`mb-6 flex items-center ${collapsed ? "justify-center" : "justify-between pl-1"}`}>
        {!collapsed && (
          <Link href="/" onClick={onNavigate} className="on-frame flex items-center gap-2.5" aria-label="CS Intake Planner home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/qu-emblem.png" alt="Qatar University" className="qu-mark h-8 w-auto object-contain" />
            <span className="leading-tight">
              <span className="block text-[13px] font-semibold text-[var(--frame-ink)]">CS Intake Planner</span>
              <span className="block text-[11px] text-[var(--frame-muted)]">Qatar University</span>
            </span>
          </Link>
        )}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--frame-muted)] hover:bg-[var(--frame-hover)] hover:text-[var(--frame-ink)]"
          >
            <Icon name="collapse" />
          </button>
        )}
      </div>

      <nav className="flex flex-col gap-0.5" aria-label="Main">
        <NavRows items={MAIN} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} />
      </nav>

      {!collapsed && <div className="mb-1.5 mt-6 px-2.5 text-[12px] text-[var(--frame-muted)]">Programs</div>}
      {collapsed && <div className="my-3 h-px bg-[var(--frame-hover)]" />}
      <nav className="flex flex-col gap-0.5" aria-label="Programs">
        <NavRows items={PROGRAMS} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} />
      </nav>

      <div className="mt-auto flex flex-col gap-2 pt-6">
        <ThemeToggle className={rowClass(false, collapsed)} showLabel={!collapsed} />
        <ProgramCard plan={plan} collapsed={collapsed} />
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [plan, setPlan] = useState<PlanRecord | null>(null);

  // Read after mount (localStorage isn't available during the server render).
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // Storage blocked: the sidebar simply starts expanded.
    }
  }, []);

  // Re-read the active program on navigation, so switching plans shows up straight away.
  useEffect(() => {
    listPlans()
      .then((plans) => setPlan(plans.find((p) => p.is_active) ?? null))
      .catch(() => setPlan(null));
  }, [pathname]);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Not remembered; fine.
    }
  };

  return (
    <div className="flex min-h-dvh bg-frame">
      <aside
        className={`no-print sticky top-0 hidden h-dvh shrink-0 lg:block ${collapsed ? "w-[68px]" : "w-[256px]"}`}
        aria-label="Sidebar"
      >
        <SidebarBody pathname={pathname} collapsed={collapsed} plan={plan} onToggleCollapse={toggleCollapse} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-black/40" />
          <aside className="absolute inset-y-0 left-0 w-[272px] bg-frame shadow-xl">
            <SidebarBody pathname={pathname} collapsed={false} plan={plan} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="no-print flex items-center justify-between px-4 py-2.5 lg:hidden">
          <Link href="/" className="on-frame flex items-center gap-2" aria-label="CS Intake Planner home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/qu-emblem.png" alt="Qatar University" className="qu-mark h-7 w-auto object-contain" />
            <span className="text-[13px] font-semibold text-[var(--frame-ink)]">CS Intake Planner</span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="grid h-9 w-9 place-items-center rounded-lg text-[var(--frame-ink)] hover:bg-[var(--frame-hover)]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>

        {/* CoAdvisor's notice strip, here the planner's honesty reminder. */}
        <div className="no-print px-4 py-1.5 text-center text-[12px] text-[var(--frame-muted)]">
          <span className="font-semibold text-[var(--frame-ink)]">Planning tool</span> · Results built on estimates are
          marked illustrative. Re-run the analysis when the schedule changes.
        </div>

        <div className="app-panel relative mx-2 mb-2 min-h-[calc(100dvh-2.75rem)] flex-1 overflow-clip rounded-2xl bg-bg lg:ml-0">
          <div className="relative z-[1]">{children}</div>
          <div className="panel-pattern pointer-events-none absolute inset-x-0 bottom-0 h-56" aria-hidden />
        </div>
      </div>
    </div>
  );
}
