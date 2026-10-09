import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { classifyHost } from "@/lib/hosts";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/inngest|api/stripe).*)"],
};

export async function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const rootDomain = process.env.ROOT_DOMAIN ?? "localhost:3000";
  const kind = classifyHost(host, rootDomain);

  // Generated client sites: rewrite into the multi-tenant renderer.
  if (kind.kind !== "app") {
    const key = kind.kind === "site" ? `sub~${kind.subdomain}` : `dom~${kind.domain}`;
    const url = req.nextUrl.clone();
    if (url.pathname.startsWith("/api/leads")) return NextResponse.next();
    url.pathname = `/sites/${key}${url.pathname === "/" ? "" : url.pathname}`;
    return NextResponse.rewrite(url);
  }

  return refreshSession(req);
}

async function refreshSession(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let res = NextResponse.next({ request: req });
  if (!url || !anon) return res;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;
  const protectedArea = path.startsWith("/agency") || path.startsWith("/portal") || path.startsWith("/preview");
  if (!user && protectedArea) {
    const login = req.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }
  return res;
}
