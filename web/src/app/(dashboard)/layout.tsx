import { SimulationProvider } from "@/lib/SimulationContext";
import { CheckpointProvider } from "@/lib/CheckpointContext";
import NavBar from "@/components/NavBar";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <NavBar />
      <SimulationProvider>
        {/* CheckpointProvider lives at the layout level (not just on the Dashboard page) so
            Bottlenecks/Auto-fill/Capacity recommendations can also read the in-progress
            checkpoint session's data when one exists — see those pages/components. */}
        <CheckpointProvider>{children}</CheckpointProvider>
      </SimulationProvider>
    </>
  );
}
