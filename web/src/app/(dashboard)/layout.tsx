import { SimulationProvider } from "@/lib/SimulationContext";
import { CheckpointProvider } from "@/lib/CheckpointContext";
import { IntakeProvider } from "@/lib/IntakeContext";
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
        {/* CheckpointProvider and IntakeProvider live at the layout level (not on one page) so
            Bottlenecks, the seat planner and Capacity recommendations can read the in-progress
            walkthrough session and the running intake analysis from any page. */}
        <CheckpointProvider>
          <IntakeProvider>{children}</IntakeProvider>
        </CheckpointProvider>
      </SimulationProvider>
    </>
  );
}
