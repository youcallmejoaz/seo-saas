import Link from "next/link";
import { inviteClientUser, removeClientUser, setClientStatus, updateClientSettings } from "@/app/agency/actions";
import { Button, Card, CardBody, CardHeader, Input, Label, Select, StatusBadge, Textarea } from "@/components/ui";
import { assertClientStaff } from "@/lib/access";
import type { ChangeKind } from "@/lib/db/types";
import { googleConfigured } from "@/lib/integrations/google";
import { adminClient } from "@/lib/supabase/admin";
import { DEFAULT_POLICY } from "@/lib/agents/policy";
import { updateGoogleProperties } from "./actions";

const KINDS: { kind: ChangeKind; label: string; risk: string }[] = [
  { kind: "meta", label: "Titles & meta descriptions", risk: "low" },
  { kind: "alt_text", label: "Image alt text", risk: "low" },
  { kind: "internal_links", label: "Internal links", risk: "low" },
  { kind: "schema", label: "Structured data", risk: "low" },
  { kind: "content_update", label: "Add / update page sections", risk: "medium" },
  { kind: "content_rewrite", label: "Remove sections", risk: "medium" },
  { kind: "new_page", label: "Create new pages", risk: "medium" },
  { kind: "slug_change", label: "Change URLs (with redirects)", risk: "high" },
  { kind: "archive_page", label: "Unpublish / noindex pages", risk: "high" },
];

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; connected?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, client, staff } = await assertClientStaff(id);
  const policy = { ...DEFAULT_POLICY, ...client.autonomy_policy };
  const [{ data: users }, { data: integ }, { data: sub }] = await Promise.all([
    supabase.from("client_users").select("user_id, profiles(email)").eq("client_id", id),
    supabase.from("integrations").select("*").eq("client_id", id).eq("provider", "google").maybeSingle(),
    supabase.from("subscriptions").select("*").eq("client_id", id).maybeSingle(),
  ]);
  // Profiles of portal users are visible to staff via RLS; fall back to admin lookup for display.
  const emails = new Map<string, string>();
  for (const u of users ?? []) {
    const p = (u as unknown as { profiles: { email: string } | null }).profiles;
    if (p?.email) emails.set(u.user_id as string, p.email);
    else {
      const { data } = await adminClient().from("profiles").select("email").eq("id", u.user_id).maybeSingle();
      if (data?.email) emails.set(u.user_id as string, data.email as string);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {sp.error && <p className="rounded bg-red-50 p-3 text-sm text-red-700 lg:col-span-2">{sp.error === "google_not_configured" ? "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable Google connections." : sp.error}</p>}
      {sp.connected && <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-700 lg:col-span-2">Google account connected.</p>}

      <Card>
        <CardHeader title="AI autonomy" description="What the AI may change without asking. Everything else goes to Approvals." />
        <CardBody>
          <form action={updateClientSettings.bind(null, id)} className="space-y-4">
            <div className="space-y-2">
              {KINDS.map((k) => (
                <label key={k.kind} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" name={`auto_${k.kind}`} defaultChecked={policy.auto_apply.includes(k.kind)} className="h-4 w-4" />
                    {k.label}
                  </span>
                  <span className="text-xs text-slate-400">{k.risk} risk</span>
                </label>
              ))}
            </div>
            <div>
              <Label htmlFor="max_auto_risk">Highest risk applied automatically</Label>
              <Select id="max_auto_risk" name="max_auto_risk" defaultValue={policy.max_auto_risk}>
                <option value="none">None (approve everything)</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="budget">Monthly AI budget (USD)</Label>
                <Input id="budget" name="budget" type="number" min={0} step="1" defaultValue={client.monthly_ai_budget_usd} />
              </div>
              <div>
                <Label htmlFor="daily_cap">Daily AI request cap</Label>
                <Input id="daily_cap" name="daily_cap" type="number" min={0} step="10" defaultValue={client.daily_ai_request_cap} />
              </div>
            </div>
            <div>
              <Label htmlFor="notes">Internal notes</Label>
              <Textarea id="notes" name="notes" rows={2} defaultValue={client.notes ?? ""} />
            </div>
            <Button type="submit">Save settings</Button>
          </form>
        </CardBody>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Google Search Console & Analytics" />
          <CardBody className="space-y-3 text-sm">
            {integ ? (
              <>
                <p>
                  <StatusBadge status={integ.status} /> {integ.account_email}
                  {integ.last_error && <span className="ml-2 text-xs text-red-600">{integ.last_error}</span>}
                </p>
                <form action={updateGoogleProperties.bind(null, id)} className="space-y-2">
                  <div>
                    <Label htmlFor="gsc">Search Console property</Label>
                    <Input id="gsc" name="gsc_property" defaultValue={integ.gsc_property ?? ""} placeholder="sc-domain:example.co.uk" />
                  </div>
                  <div>
                    <Label htmlFor="ga4">GA4 property ID</Label>
                    <Input id="ga4" name="ga4_property_id" defaultValue={integ.ga4_property_id ?? ""} placeholder="123456789" />
                  </div>
                  <Button size="sm" variant="secondary">Save properties</Button>
                </form>
              </>
            ) : (
              <p className="text-slate-500">Not connected.</p>
            )}
            {googleConfigured() ? (
              <Link href={`/api/google/oauth/start?clientId=${id}`}><Button size="sm">{integ ? "Reconnect Google" : "Connect Google"}</Button></Link>
            ) : (
              <p className="text-xs text-slate-500">Google OAuth is not configured on this deployment.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Client portal access" description="Clients only ever see their own dashboard." />
          <CardBody className="space-y-3">
            <ul className="space-y-1 text-sm">
              {(users ?? []).map((u) => (
                <li key={u.user_id as string} className="flex items-center justify-between">
                  {emails.get(u.user_id as string) ?? u.user_id}
                  <form action={removeClientUser.bind(null, id, u.user_id as string)}><Button size="sm" variant="ghost">Remove</Button></form>
                </li>
              ))}
              {!users?.length && <li className="text-slate-500">No portal users yet.</li>}
            </ul>
            <form action={inviteClientUser.bind(null, id)} className="flex gap-2">
              <Input name="email" type="email" placeholder="owner@client.co.uk" required />
              <Button size="sm" variant="secondary">Invite</Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Lifecycle & billing" />
          <CardBody className="space-y-3 text-sm">
            <p>Status: <StatusBadge status={client.status} /> · Subscription: {sub ? <StatusBadge status={sub.status} /> : "none"}</p>
            <div className="flex flex-wrap gap-2">
              {client.status !== "active" && client.status !== "offboarded" && <form action={setClientStatus.bind(null, id, "active")}><Button size="sm">Activate</Button></form>}
              {client.status === "active" && <form action={setClientStatus.bind(null, id, "paused")}><Button size="sm" variant="secondary">Pause all AI work</Button></form>}
              {client.status === "offboarded" && <form action={setClientStatus.bind(null, id, "active")}><Button size="sm" variant="secondary">Reactivate</Button></form>}
              {client.status !== "offboarded" && staff.agency.role !== "member" && (
                <form action={setClientStatus.bind(null, id, "offboarded")}><Button size="sm" variant="danger">Offboard</Button></form>
              )}
            </div>
            <p className="text-xs text-slate-500">Pausing cancels queued tasks and stops scheduled work. Offboarding also archives the website and revokes portal access.</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
