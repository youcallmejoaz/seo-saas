import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = req.nextUrl.searchParams.get("next") ?? "/";
  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return NextResponse.redirect(new URL(target, req.url));
}
