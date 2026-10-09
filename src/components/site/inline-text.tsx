import Link from "next/link";
import { Fragment } from "react";

const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;

function safeHref(href: string): string | null {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (/^https?:\/\//.test(href) || href.startsWith("tel:") || href.startsWith("mailto:") || href.startsWith("#")) return href;
  return null;
}

/** Renders text with [anchor](/path) links. Everything else is escaped by React. */
export function InlineText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    const href = safeHref(m[2]!);
    if (href?.startsWith("/")) parts.push(<Link key={idx} href={href}>{m[1]}</Link>);
    else if (href) parts.push(<a key={idx} href={href} rel="noopener">{m[1]}</a>);
    else parts.push(m[1]);
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}
