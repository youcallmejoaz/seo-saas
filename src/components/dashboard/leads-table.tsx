import { Badge, Table, Td, Th } from "@/components/ui";
import type { Lead } from "@/lib/db/types";

export function LeadsTable({ leads, compact = false }: { leads: Lead[]; compact?: boolean }) {
  if (compact)
    return (
      <ul className="divide-y divide-slate-100">
        {leads.map((l) => (
          <li key={l.id} className="px-5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-slate-800">{l.name ?? l.email ?? l.phone}</p>
              <time className="shrink-0 text-xs text-slate-400">{new Date(l.created_at).toLocaleDateString("en-GB")}</time>
            </div>
            {l.message && <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{l.message}</p>}
            <p className="mt-0.5 text-xs text-slate-400">{[l.email, l.phone, l.page_path].filter(Boolean).join(" · ")}</p>
          </li>
        ))}
      </ul>
    );
  return (
    <Table>
      <thead><tr><Th>When</Th><Th>Name</Th><Th>Contact</Th><Th>Message</Th><Th>Page</Th><Th>Source</Th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {leads.map((l) => (
          <tr key={l.id}>
            <Td className="whitespace-nowrap text-xs">{new Date(l.created_at).toLocaleString("en-GB")}</Td>
            <Td className="whitespace-nowrap">{l.name}</Td>
            <Td className="text-xs">{l.email}<br />{l.phone}</Td>
            <Td className="max-w-sm text-xs text-slate-600">{l.message}</Td>
            <Td className="text-xs">{l.page_path}</Td>
            <Td><Badge tone={l.source === "organic" ? "green" : "gray"}>{l.source}</Badge></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
