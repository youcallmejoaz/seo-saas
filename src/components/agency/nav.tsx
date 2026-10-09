"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({ href, children, badge, exact }: { href: string; children: React.ReactNode; badge?: number; exact?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium",
        active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
      )}
    >
      <span>{children}</span>
      {!!badge && <span className="rounded-full bg-amber-100 px-2 text-xs text-amber-800">{badge}</span>}
    </Link>
  );
}

export function TabLink({ href, children, exact }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path.startsWith(href);
  return (
    <Link href={href} className={cn("border-b-2 px-1 pb-3 text-sm font-medium", active ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
      {children}
    </Link>
  );
}
