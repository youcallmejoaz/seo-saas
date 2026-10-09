"use client";
import { useState } from "react";

export function LeadForm({ siteId, pagePath }: { siteId: string; pagePath: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...Object.fromEntries(form), siteId, pagePath, referrer: document.referrer }),
    });
    setState(res.ok ? "sent" : "error");
  }

  if (state === "sent") return <p className="mt-6 rounded-lg bg-emerald-50 p-4 text-emerald-800">Thanks — we&apos;ll be in touch shortly.</p>;

  const field = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2";
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      {/* Honeypot: real visitors never see or fill this. */}
      <input type="text" name="company_website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Name<input name="name" required className={field} /></label>
        <label className="block text-sm font-medium">Phone<input name="phone" type="tel" className={field} /></label>
      </div>
      <label className="block text-sm font-medium">Email<input name="email" type="email" required className={field} /></label>
      <label className="block text-sm font-medium">How can we help?<textarea name="message" rows={4} className={field} /></label>
      <button disabled={state === "sending"} className="rounded-md bg-site-primary px-6 py-3 font-semibold text-white disabled:opacity-60">
        {state === "sending" ? "Sending…" : "Send enquiry"}
      </button>
      {state === "error" && <p className="text-sm text-red-600">Something went wrong. Please call us instead.</p>}
    </form>
  );
}
