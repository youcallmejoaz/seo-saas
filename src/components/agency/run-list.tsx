import Link from "next/link";
import { StatusBadge } from "@/components/ui";
import type { Run } from "@/lib/db/types";

const KIND: Record<string, string> = {
  command: "AI command",
  site_generate: "Website generation",
  site_edit: "Website edit",
  campaign_plan: "Campaign plan",
  task_execute: "SEO task",
  task_measure: "Impact measurement",
  audit: "Technical audit",
  sync: "Data sync",
  scan: "Opportunity scan",
  report: "Monthly report",
};

export function kindLabel(kind: string) {
  return KIND[kind] ?? kind;
}

export function RunList({ runs, clients }: { runs: Run[]; clients?: Record<string, string> }) {
  if (!runs.length) return <p className="px-5 py-6 text-sm text-slate-500">No activity yet.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {runs.map((r) => (
        <li key={r.id}>
          <Link href={`/agency/runs/${r.id}`} className="flex items-start justify-between gap-4 px-5 py-3 hover:bg-slate-50">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">{r.prompt || kindLabel(r.kind)}</p>
              <p className="text-xs text-slate-500">
                {kindLabel(r.kind)}
                {r.client_id && clients?.[r.client_id] ? ` · ${clients[r.client_id]}` : ""} · {new Date(r.created_at).toLocaleString("en-GB")}
              </p>
            </div>
            <StatusBadge status={r.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
