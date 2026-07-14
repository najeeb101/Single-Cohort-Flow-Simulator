"use client";

import StudentTracePanel from "@/components/StudentTracePanel";

export default function StudentsPage() {
  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Student Trace</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-muted">
          Follow one synthetic student through the program, term by term: the courses they took and passed or
          failed, where they got stuck and why, how their GPA moved, and how their journey ended. A window into
          the individual paths behind the aggregate numbers.
        </p>
      </header>
      <StudentTracePanel />
    </main>
  );
}
