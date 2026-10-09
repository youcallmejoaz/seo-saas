import { decideChangeSet, rollbackAction } from "@/app/agency/actions";
import { Badge, Button, StatusBadge } from "@/components/ui";
import type { ChangeSetRow } from "@/lib/db/types";
import { describeOp, type ChangeOp } from "@/lib/site/changes";

export function ChangeSetCard({ cs, clientName, previewHref }: { cs: ChangeSetRow; clientName?: string; previewHref?: string }) {
  const ops = cs.ops as ChangeOp[];
  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{cs.summary}</p>
          <p className="text-xs text-slate-500">
            {clientName && <>{clientName} · </>}
            {new Date(cs.created_at).toLocaleString("en-GB")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={cs.risk === "high" ? "red" : cs.risk === "medium" ? "yellow" : "gray"}>{cs.risk} risk</Badge>
          <StatusBadge status={cs.status} />
        </div>
      </div>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
        {ops.map((op, i) => <li key={i}>{describeOp(op)}</li>)}
      </ul>
      {cs.rationale && <p className="mt-2 whitespace-pre-wrap text-xs text-slate-500">{cs.rationale}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-slate-500">Exact changes</summary>
        <pre className="mt-1 max-h-80 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(ops, null, 2)}</pre>
      </details>
      <div className="mt-3 flex gap-2">
        {cs.status === "proposed" && (
          <>
            <form action={decideChangeSet.bind(null, cs.id, "approved")}><Button size="sm">Approve &amp; apply</Button></form>
            <form action={decideChangeSet.bind(null, cs.id, "rejected")}><Button size="sm" variant="secondary">Reject</Button></form>
          </>
        )}
        {cs.status === "applied" && <form action={rollbackAction.bind(null, cs.id)}><Button size="sm" variant="ghost">Roll back</Button></form>}
        {previewHref && <a href={previewHref} target="_blank" className="self-center text-xs text-brand-600">Preview site →</a>}
      </div>
    </div>
  );
}
