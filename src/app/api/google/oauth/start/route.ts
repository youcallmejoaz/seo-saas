import { NextResponse, type NextRequest } from "next/server";
import { assertClientStaff } from "@/lib/access";
import { sign } from "@/lib/crypto";
import { authUrl, googleConfigured } from "@/lib/integrations/google";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId") ?? "";
  const { staff } = await assertClientStaff(clientId);
  if (!googleConfigured()) return NextResponse.redirect(new URL(`/agency/clients/${clientId}/settings?error=google_not_configured`, req.url));
  const state = sign(JSON.stringify({ clientId, userId: staff.userId, ts: Date.now() }));
  return NextResponse.redirect(authUrl(state));
}
