import { SimulationProvider } from "@/lib/SimulationContext";
import NavBar from "@/components/NavBar";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <NavBar />
      <SimulationProvider>{children}</SimulationProvider>
    </>
  );
}
