"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { RunEvent, RunStatus } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/markdown";

const TERMINAL: RunStatus[] = ["succeeded", "failed", "cancelled", "awaiting_approval"];

/** Live activity log for a run: polls run_events until the run reaches a terminal state. */
export function RunLog({ runId, initialEvents, initialStatus }: { runId: string; initialEvents: RunEvent[]; initialStatus: RunStatus }) {
  const [events, setEvents] = useState(initialEvents);
  const [status, setStatus] = useState(initialStatus);
  const lastId = useRef(initialEvents.at(-1)?.id ?? 0);
  const router = useRouter();

  useEffect(() => {
    if (TERMINAL.includes(status)) return;
    const supabase = createBrowserSupabase();
    const timer = setInterval(async () => {
      const [{ data: fresh }, { data: run }] = await Promise.all([
        supabase.from("run_events").select("id, run_id, ts, level, type, message, data").eq("run_id", runId).gt("id", lastId.current).order("id"),
        supabase.from("runs").select("status").eq("id", runId).single(),
      ]);
      if (fresh?.length) {
        lastId.current = fresh.at(-1)!.id as number;
        setEvents((e) => [...e, ...(fresh as RunEvent[])]);
      }
      if (run && run.status !== status) {
        setStatus(run.status as RunStatus);
        if (TERMINAL.includes(run.status as RunStatus)) router.refresh();
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [runId, status, router]);

  return (
    <div>
      {!TERMINAL.includes(status) && (
        <p className="mb-3 flex items-center gap-2 text-sm text-brand-700">
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" /> Working… ({status})
        </p>
      )}
      <ol className="space-y-2">
        {events.map((e) => (
          <li key={e.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
            <div className="flex items-start justify-between gap-3">
              <span className={cn("font-medium", e.level === "error" ? "text-red-700" : e.level === "warn" ? "text-amber-700" : e.type === "message" ? "text-slate-900" : "text-slate-700")}>
                <span className="mr-2 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-500 ring-1 ring-slate-200">{e.type.replace("_", " ")}</span>
                {e.type === "message" ? <Markdown md={e.message} className="mt-1 text-slate-900" /> : e.message}
              </span>
              <time className="shrink-0 text-xs text-slate-400">{new Date(e.ts).toLocaleTimeString("en-GB")}</time>
            </div>
            {e.data != null && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-slate-500">details</summary>
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify(e.data, null, 2)}</pre>
              </details>
            )}
          </li>
        ))}
        {!events.length && <li className="text-sm text-slate-500">Waiting for the first step…</li>}
      </ol>
    </div>
  );
}
