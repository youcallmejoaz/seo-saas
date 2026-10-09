import { Fragment } from "react";

// Minimal, safe Markdown for AI-written text: ## headings, "- " bullets and **bold**.
// Everything is rendered as React text, so model output can never inject HTML.

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function Markdown({ md, className = "" }: { md: string; className?: string }) {
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={`ul${out.length}`} className="list-disc space-y-1 pl-5">{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
    bullets = [];
  };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*[-*] /.test(line)) {
      bullets.push(line.replace(/^\s*[-*] /, ""));
      continue;
    }
    flush();
    if (/^#{1,4} /.test(line)) out.push(<h4 key={out.length} className="pt-2 font-semibold text-slate-900">{inline(line.replace(/^#+ /, ""))}</h4>);
    else if (line.trim()) out.push(<p key={out.length}>{inline(line)}</p>);
  }
  flush();
  return <div className={`space-y-2 text-sm text-slate-700 ${className}`}>{out}</div>;
}
