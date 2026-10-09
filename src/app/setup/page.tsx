import { Card } from "@/components/ui";

export const metadata = { title: "Setup required" };

export default function SetupPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <Card className="p-6">
        <h1 className="text-lg font-semibold">Finish configuring RankPilot</h1>
        <p className="mt-2 text-sm text-slate-600">
          Supabase is not configured. Copy <code>.env.example</code> to <code>.env.local</code>, fill in your Supabase
          project URL and keys, apply the migrations in <code>supabase/migrations</code>, and restart the dev server.
          See the README for the full setup guide.
        </p>
      </Card>
    </div>
  );
}
