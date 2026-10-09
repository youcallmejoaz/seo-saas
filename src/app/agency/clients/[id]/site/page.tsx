import Link from "next/link";
import { publishSiteAction, regenerateSite, requestSiteEdit, setCustomDomain, verifyDomain, decideChangeSet, rollbackAction } from "@/app/agency/actions";
import { RunLog } from "@/components/agency/run-log";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, StatusBadge, Table, Td, Textarea, Th } from "@/components/ui";
import { assertClientStaff } from "@/lib/access";
import type { ChangeSetRow, PageRow, Run, RunEvent, Site } from "@/lib/db/types";
import { env } from "@/lib/env";
import { siteUrl } from "@/lib/hosts";
import { checkDomain } from "@/lib/integrations/vercel-domains";
import { describeOp, type ChangeOp } from "@/lib/site/changes";
import { toPageState } from "@/lib/site/load";
import { pageText, pathForSlug, wordCount } from "@/lib/site/schema";
import { lintScore, lintSite } from "@/lib/site/seo-lint";

export const metadata = { title: "Website" };

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await assertClientStaff(id);
  const { data: siteRow } = await supabase.from("sites").select("*").eq("client_id", id).neq("status", "archived").order("created_at").limit(1).maybeSingle();
  if (!siteRow) return <EmptyState title="No website yet">Onboard flow creates one automatically.</EmptyState>;
  const site = siteRow as Site;

  const [{ data: pageRows }, { data: lastRun }, { data: changes }] = await Promise.all([
    supabase.from("pages").select("*").eq("site_id", site.id).neq("status", "archived").order("type").order("slug"),
    supabase.from("runs").select("*").eq("client_id", id).in("kind", ["site_generate", "site_edit"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("change_sets").select("*").eq("site_id", site.id).order("created_at", { ascending: false }).limit(15),
  ]);
  const pages = (pageRows ?? []).map((r) => toPageState(r as PageRow));
  const issues = lintSite(pages);
  const run = lastRun as Run | null;
  const { data: events } = run ? await supabase.from("run_events").select("*").eq("run_id", run.id).order("id") : { data: [] };
  const url = siteUrl(site, env().ROOT_DOMAIN, env().NEXT_PUBLIC_APP_URL);
  const domain = site.custom_domain ? await checkDomain(site.custom_domain) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader
            title="Website"
            description={
              <>
                <StatusBadge status={site.status} />{" "}
                {site.status === "published" ? <a href={url} target="_blank" className="ml-2 text-brand-600 hover:underline">{url}</a> : <span className="ml-2">Not live yet</span>}
              </>
            }
            action={
              <div className="flex gap-2">
                {pages[0] && <Link href={`/preview/${site.id}`} target="_blank"><Button variant="secondary" size="sm">Preview</Button></Link>}
                {site.status !== "published" && pages.length > 0 && (
                  <form action={publishSiteAction.bind(null, id, site.id)}><Button size="sm">Publish site</Button></form>
                )}
              </div>
            }
          />
          {pages.length ? (
            <Table>
              <thead><tr><Th>Page</Th><Th>Type</Th><Th>Target keyword</Th><Th className="text-right">Words</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {pages.map((p) => (
                  <tr key={p.id}>
                    <Td>
                      <Link href={`/preview/${site.id}${pathForSlug(p.slug) === "/" ? "" : pathForSlug(p.slug)}`} target="_blank" className="font-medium text-slate-900 hover:underline">{p.h1}</Link>
                      <p className="text-xs text-slate-500">{pathForSlug(p.slug)} · {p.title}</p>
                    </Td>
                    <Td className="text-xs">{p.type.replace("_", " ")}</Td>
                    <Td className="text-xs">{p.target_keyword ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{wordCount(pageText(p))}</Td>
                    <Td><StatusBadge status={p.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <CardBody><p className="text-sm text-slate-500">Pages will appear here once generation finishes.</p></CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Change history" description="Every AI and human edit, with approval and rollback." />
          <ul className="divide-y divide-slate-100">
            {((changes ?? []) as ChangeSetRow[]).map((c) => (
              <li key={c.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{c.summary}</p>
                    <ul className="mt-1 list-disc pl-5 text-xs text-slate-500">
                      {(c.ops as ChangeOp[]).slice(0, 5).map((op, i) => <li key={i}>{describeOp(op)}</li>)}
                    </ul>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={c.risk === "high" ? "red" : c.risk === "medium" ? "yellow" : "gray"}>{c.risk}</Badge>
                    <StatusBadge status={c.status} />
                    {c.status === "proposed" && (
                      <>
                        <form action={decideChangeSet.bind(null, c.id, "approved")}><Button size="sm">Approve</Button></form>
                        <form action={decideChangeSet.bind(null, c.id, "rejected")}><Button size="sm" variant="secondary">Reject</Button></form>
                      </>
                    )}
                    {c.status === "applied" && (
                      <form action={rollbackAction.bind(null, c.id)}><Button size="sm" variant="ghost">Roll back</Button></form>
                    )}
                  </div>
                </div>
              </li>
            ))}
            {!changes?.length && <li className="px-5 py-4 text-sm text-slate-500">No changes yet.</li>}
          </ul>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Edit with AI" description="Describe the change in plain English." />
          <CardBody>
            <form action={requestSiteEdit.bind(null, id, site.id)} className="space-y-3">
              <Textarea name="instruction" rows={4} placeholder="Add a page about landlord gas safety certificates in Birmingham and link to it from the boiler repair page." />
              <Button type="submit" className="w-full">Send to AI</Button>
            </form>
          </CardBody>
        </Card>

        {run && (
          <Card>
            <CardHeader title="Latest AI run" description={run.prompt ?? run.kind} action={<Link href={`/agency/runs/${run.id}`} className="text-sm text-brand-600">Open →</Link>} />
            <CardBody className="max-h-96 overflow-auto">
              <RunLog runId={run.id} initialEvents={(events ?? []).slice(-12) as RunEvent[]} initialStatus={run.status} />
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="On-page SEO" description={`Score ${lintScore(issues, pages.length)}/100 · ${issues.length} findings`} />
          <ul className="max-h-72 divide-y divide-slate-100 overflow-auto">
            {issues.slice(0, 25).map((i, n) => (
              <li key={n} className="px-5 py-2 text-xs">
                <Badge tone={i.severity === "critical" ? "red" : i.severity === "warning" ? "yellow" : "gray"}>{i.severity}</Badge>
                <span className="ml-2 text-slate-600">{pathForSlug(i.page)}: {i.message}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Domain" />
          <CardBody className="space-y-3 text-sm">
            <p className="text-slate-600">Subdomain: <span className="font-mono">{site.subdomain}.{env().ROOT_DOMAIN}</span></p>
            {domain ? (
              <>
                <p>
                  <span className="font-mono">{domain.domain}</span>{" "}
                  <StatusBadge status={site.domain_verified ? "connected" : "pending"} />
                </p>
                {!site.domain_verified && (
                  <>
                    <p className="text-xs text-slate-500">Add these DNS records at the client&apos;s registrar:</p>
                    <ul className="space-y-1 font-mono text-xs">
                      {domain.instructions.map((r, i) => <li key={i}>{r.type} {r.name} → {r.value}</li>)}
                    </ul>
                    <form action={verifyDomain.bind(null, id, site.id, domain.domain)}><Button size="sm" variant="secondary">Check again</Button></form>
                  </>
                )}
              </>
            ) : (
              <form action={setCustomDomain.bind(null, id, site.id)} className="flex gap-2">
                <Input name="domain" placeholder="brumplumbing.co.uk" />
                <Button type="submit" size="sm" variant="secondary">Connect</Button>
              </form>
            )}
          </CardBody>
        </Card>

        {/* Regeneration replaces every page, so it is only offered before the site goes live. */}
        {site.status !== "published" && site.status !== "generating" && (
          <form action={regenerateSite.bind(null, id, site.id)}>
            <Button variant="ghost" size="sm" className="text-red-600">Regenerate entire site</Button>
          </form>
        )}
      </div>
    </div>
  );
}
