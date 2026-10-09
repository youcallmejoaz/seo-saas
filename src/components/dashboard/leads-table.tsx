import { Badge, Table, Td, Th } from "@/components/ui";
import type { Lead } from "@/lib/db/types";

export function LeadsTable({ leads }: { leads: Lead[] }) {
  return (
    <Table>
      <thead><tr><Th>When</Th><Th>Name</Th><Th>Contact</Th><Th>Message</Th><Th>Page</Th><Th>Source</Th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {leads.map((l) => (
          <tr key={l.id}>
            <Td className="whitespace-nowrap text-xs">{new Date(l.created_at).toLocaleString("en-GB")}</Td>
            <Td>{l.name}</Td>
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
