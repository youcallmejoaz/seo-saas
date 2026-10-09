import { redirect } from "next/navigation";
import { Button, Card, Input, Label } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { slugify, errorMessage } from "@/lib/utils";

export const metadata = { title: "Create workspace" };

async function createWorkspace(formData: FormData) {
  "use server";
  const agencyName = String(formData.get("agency") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const supabase = await createClient();
  try {
    let {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      user = data.user;
      if (!user) throw new Error("Sign-up did not return a user");
      if (!data.session) await supabase.auth.signInWithPassword({ email, password });
    }
    // Creating the agency + owner membership needs the service role: a brand-new user is
    // not yet a member of anything, so RLS would (correctly) refuse the insert.
    const admin = adminClient();
    const { data: agency, error } = await admin
      .from("agencies")
      .insert({ name: agencyName, slug: `${slugify(agencyName)}-${Math.random().toString(36).slice(2, 6)}` })
      .select("id")
      .single();
    if (error) throw error;
    const { error: mErr } = await admin.from("memberships").insert({ agency_id: agency.id, user_id: user.id, role: "owner" });
    if (mErr) throw mErr;
  } catch (err) {
    redirect(`/signup?error=${encodeURIComponent(errorMessage(err))}`);
  }
  redirect("/agency");
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold">Create your agency workspace</h1>
      {error && <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <form action={createWorkspace} className="mt-4 space-y-3">
        <div>
          <Label htmlFor="agency">Agency name</Label>
          <Input id="agency" name="agency" required />
        </div>
        {!user && (
          <>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" minLength={8} required />
            </div>
          </>
        )}
        <Button type="submit" className="w-full">Create workspace</Button>
      </form>
    </Card>
  );
}
