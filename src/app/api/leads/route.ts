import { NextResponse } from "next/server";
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";

const body = z.object({
  siteId: z.string().uuid(),
  pagePath: z.string().max(300).optional(),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  message: z.string().trim().max(4000).optional(),
  referrer: z.string().max(500).optional(),
  company_website: z.string().optional(), // honeypot
});

/** Enquiry form endpoint used by every generated site. Leads feed the client dashboard. */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const d = parsed.data;
  if (d.company_website) return NextResponse.json({ ok: true }); // bot: pretend success
  if (!d.email && !d.phone) return NextResponse.json({ error: "email or phone required" }, { status: 400 });

  const db = adminClient();
  const { data: site } = await db.from("sites").select("id, client_id").eq("id", d.siteId).eq("status", "published").maybeSingle();
  if (!site) return NextResponse.json({ error: "unknown site" }, { status: 404 });

  const ref = d.referrer ?? "";
  const source = /google\.|bing\.|duckduckgo\.|yahoo\./.test(ref) ? "organic" : ref ? "referral" : "direct";
  const { error } = await db.from("leads").insert({
    client_id: site.client_id,
    site_id: site.id,
    page_path: d.pagePath,
    name: d.name,
    email: d.email || null,
    phone: d.phone,
    message: d.message,
    source,
    meta: { referrer: ref || null, user_agent: req.headers.get("user-agent") },
  });
  if (error) return NextResponse.json({ error: "could not save" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
