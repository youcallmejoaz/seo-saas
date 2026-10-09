import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.clientIds.length) redirect(viewer.agency ? "/agency" : "/login");
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <span className="font-bold text-brand-700">Your SEO dashboard</span>
          <div className="flex items-center gap-4 text-sm text-slate-500">
            <span className="hidden sm:inline">{viewer.email}</span>
            <form action="/auth/signout" method="post"><button className="hover:text-slate-900">Sign out</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
