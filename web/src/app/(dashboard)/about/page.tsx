"use client";

import { useRouter } from "next/navigation";
import OnboardingIntro from "@/components/OnboardingIntro";

// Replays the first-run intro on demand (e.g. showing a colleague the tool, or double-checking
// the page guide) — same step content as the gated OnboardingIntro shown before the dashboard's
// first load, just reached via a normal nav link instead of localStorage gating, and with
// nothing to skip since there's no gate to dismiss.
export default function AboutPage() {
  const router = useRouter();
  return <OnboardingIntro onComplete={() => router.push("/")} showSkip={false} />;
}
