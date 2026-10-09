import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function formatNumber(n: number | null | undefined, opts: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat("en-GB", opts).format(n ?? 0);
}

export function formatUsd(n: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(n ?? 0));
}

export function daysAgo(n: number, from = new Date()): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
