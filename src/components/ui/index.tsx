import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({ className, variant = "primary", size = "md", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-brand-600 text-white hover:bg-brand-700",
        variant === "secondary" && "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
        variant === "ghost" && "text-slate-700 hover:bg-slate-100",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-slate-200 bg-white shadow-sm", className)} {...props} />;
}

export function CardHeader({ title, description, action }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

const badgeTones = {
  gray: "bg-slate-100 text-slate-700",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  yellow: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  blue: "bg-brand-50 text-brand-700 ring-brand-600/20",
  purple: "bg-violet-50 text-violet-700 ring-violet-600/20",
} as const;

export type BadgeTone = keyof typeof badgeTones;

export function Badge({ tone = "gray", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent", badgeTones[tone], className)}
      {...props}
    />
  );
}

export function statusTone(status: string): BadgeTone {
  if (["active", "published", "succeeded", "done", "applied", "completed", "connected"].includes(status)) return "green";
  if (["paused", "awaiting_approval", "proposed", "planning", "planned", "trialing", "draft"].includes(status)) return "yellow";
  if (["failed", "offboarded", "rejected", "error", "past_due", "canceled", "unpaid"].includes(status)) return "red";
  if (["running", "generating", "queued", "onboarding"].includes(status)) return "blue";
  if (["rolled_back"].includes(status)) return "purple";
  return "gray";
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status.replace(/_/g, " ")}</Badge>;
}

export const inputClass =
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputClass, "min-h-24", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputClass, props.className)} />;
}

export function Label({ children, hint, ...props }: React.LabelHTMLAttributes<HTMLLabelElement> & { hint?: string }) {
  return (
    <label {...props} className={cn("block text-sm font-medium text-slate-700", props.className)}>
      {children}
      {hint && <span className="ml-1 font-normal text-slate-400">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, delta, hint }: { label: string; value: React.ReactNode; delta?: number | null; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {delta !== undefined && delta !== null && (
        <p className={cn("mt-1 text-xs font-medium", delta >= 0 ? "text-emerald-600" : "text-red-600")}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}% vs previous period
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-4 py-2.5 align-top text-slate-700", className)}>{children}</td>;
}
