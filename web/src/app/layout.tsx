import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// Applies the saved theme before paint, so toggling light mode on one visit doesn't
// flash dark-then-light on the next. Defaults to dark (the existing look) when nothing
// is stored yet — ThemeToggle.tsx is the only thing that ever writes localStorage.theme.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    if (localStorage.getItem("theme") === "light") {
      document.documentElement.classList.add("theme-light");
    }
  } catch (e) {}
})();
`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "QU CS — Flow Simulator Dashboard",
  description: "Cohort analytics, bottlenecks, and live what-if scenarios for the multi-cohort curriculum flow simulator.",
};

// NavBar + SimulationProvider live in (dashboard)/layout.tsx, not here — /login and
// /register must not be wrapped by SimulationProvider, since its mount effect fetches
// /meta + /simulate (now auth-gated) and would render an error box instead of the login
// form for a not-yet-authenticated visitor.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
