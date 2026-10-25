import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// Applies the saved theme before paint, so choosing dark mode on one visit doesn't flash
// light-then-dark on the next. Light (the CoAdvisor look) is the default when nothing is
// stored — ThemeToggle.tsx is the only thing that ever writes localStorage.theme.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    if (localStorage.getItem("theme") === "dark") {
      document.documentElement.classList.add("theme-dark");
    }
  } catch (e) {}
})();
`;

// Inter, as on QU CoAdvisor.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CS Intake Planner",
  description: "How many students should Qatar University's CS department admit next, and what course seats does that need?",
};

// AppShell + SimulationProvider live in (dashboard)/layout.tsx, not the root — pages outside
// the dashboard (if any) don't get the simulation context overhead.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
