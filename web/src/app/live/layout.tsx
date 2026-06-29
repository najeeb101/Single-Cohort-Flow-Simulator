import NavBar from "@/components/NavBar";

// Deliberately separate from (dashboard)/layout.tsx: that layout wraps every page in
// SimulationProvider, which renders a "Loading…"/"Start simulation" gate screen INSTEAD of
// `children` until a baseline /simulate run has completed (see SimulationContext.tsx). The
// Live Simulation feature is independent of that baseline — it fetches its own data via
// listLiveSims/getLiveSim directly — so it must not sit behind that gate. This layout just
// repeats the NavBar so /live still looks like part of the dashboard chrome.
export default function LiveLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <NavBar />
      {children}
    </>
  );
}
