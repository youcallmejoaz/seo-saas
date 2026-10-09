import { redirect } from "next/navigation";
import { getViewer, homePathFor } from "@/lib/auth";

export default async function Home() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) redirect("/setup");
  redirect(await homePathFor(await getViewer()));
}
