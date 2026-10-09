import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Input, Label } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export const metadata = { title: "Sign in" };

async function signIn(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  if (!password) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${env().NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    redirect(`/login?${new URLSearchParams(error ? { error: error.message } : { sent: "1" })}`);
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?${new URLSearchParams({ error: error.message, next })}`);
  redirect(next);
}

function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-slate-500">Agency staff and clients both sign in here.</p>
      {sp.error && <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{sp.error}</p>}
      {sp.sent && <p className="mt-3 rounded bg-emerald-50 p-2 text-sm text-emerald-700">Check your email for a sign-in link.</p>}
      <form action={signIn} className="mt-4 space-y-3">
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <Label htmlFor="password" hint="(leave blank for a magic link)">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" />
        </div>
        <Button type="submit" className="w-full">Continue</Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        New agency? <Link href="/signup" className="text-brand-600 hover:underline">Create a workspace</Link>
      </p>
    </Card>
  );
}
