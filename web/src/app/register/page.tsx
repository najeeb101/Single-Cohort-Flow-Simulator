"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Registration failed");
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-sm px-7 py-16">
      <h1 className="mb-6 text-[19px] font-bold tracking-tight">Create an account</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
        <label className="flex flex-col gap-1.5 text-[12.5px] text-muted">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-[9px] border border-border-2 bg-surface-2 px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[12.5px] text-muted">
          Password
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-[9px] border border-border-2 bg-surface-2 px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
          />
        </label>
        {error && <p className="text-[12.5px] text-bad">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="mt-1.5 rounded-[9px] bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Creating account…" : "Register"}
        </button>
      </form>
      <p className="mt-4 text-[12.5px] text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent">
          Sign in
        </Link>
      </p>
    </main>
  );
}
