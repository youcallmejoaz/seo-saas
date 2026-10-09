import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Agency } from "@/lib/db/types";

export type Viewer = {
  userId: string;
  email: string | null;
  agency: (Agency & { role: "owner" | "admin" | "member" }) | null;
  clientIds: string[];
};

/** Resolves who is signed in and which agency / client portals they belong to. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: memberships }, { data: clientLinks }] = await Promise.all([
    supabase.from("memberships").select("role, agencies(*)").eq("user_id", user.id).limit(1),
    supabase.from("client_users").select("client_id").eq("user_id", user.id),
  ]);
  const m = memberships?.[0] as { role: "owner" | "admin" | "member"; agencies: Agency } | undefined;
  return {
    userId: user.id,
    email: user.email ?? null,
    agency: m ? { ...m.agencies, role: m.role } : null,
    clientIds: (clientLinks ?? []).map((c) => c.client_id as string),
  };
});

export async function requireStaff() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.agency) redirect(viewer.clientIds.length ? "/portal" : "/signup");
  return { ...viewer, agency: viewer.agency };
}

export async function requireAdmin() {
  const staff = await requireStaff();
  if (staff.agency.role === "member") throw new Error("Only agency owners and admins can do this.");
  return staff;
}

export async function homePathFor(viewer: Viewer | null): Promise<string> {
  if (!viewer) return "/login";
  if (viewer.agency) return "/agency";
  if (viewer.clientIds.length) return "/portal";
  return "/signup";
}
