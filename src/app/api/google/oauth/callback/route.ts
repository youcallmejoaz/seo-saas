import { NextResponse, type NextRequest } from "next/server";
import { assertClientStaff } from "@/lib/access";
import { verify } from "@/lib/crypto";
import { accessToken, exchangeCode, listGa4Properties, listGscProperties, matchGscProperty, saveGoogleIntegration } from "@/lib/integrations/google";
import { primarySiteFor } from "@/lib/site/repo";
import { adminClient } from "@/lib/supabase/admin";
import { errorMessage } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const raw = verify(req.nextUrl.searchParams.get("state") ?? "");
  const state = raw ? (JSON.parse(raw) as { clientId: string; userId: string; ts: number }) : null;
  if (!state || Date.now() - state.ts > 15 * 60_000) return NextResponse.json({ error: "invalid or expired state" }, { status: 400 });
  const { staff } = await assertClientStaff(state.clientId);
  if (staff.userId !== state.userId) return NextResponse.json({ error: "state does not match the signed-in user" }, { status: 400 });

  const back = new URL(`/agency/clients/${state.clientId}/settings`, req.url);
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    back.searchParams.set("error", req.nextUrl.searchParams.get("error") ?? "google_denied");
    return NextResponse.redirect(back);
  }
  try {
    const { tokens, email } = await exchangeCode(code);
    const integrationId = await saveGoogleIntegration(state.clientId, tokens, email);
    // Best-effort auto-selection of the matching Search Console + GA4 properties.
    const token = await accessToken(integrationId);
    const site = await primarySiteFor(state.clientId);
    const [gsc, ga4] = await Promise.all([listGscProperties(token).catch(() => []), listGa4Properties(token).catch(() => [])]);
    const domain = site?.custom_domain ?? "";
    await adminClient()
      .from("integrations")
      .update({ gsc_property: domain ? matchGscProperty(gsc, domain) : null, ga4_property_id: ga4.length === 1 ? ga4[0]!.id : null })
      .eq("id", integrationId);
    back.searchParams.set("connected", "google");
  } catch (err) {
    back.searchParams.set("error", errorMessage(err).slice(0, 200));
  }
  return NextResponse.redirect(back);
}
