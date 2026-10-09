import Link from "next/link";
import type { Block } from "@/lib/site/schema";
import { InlineText } from "./inline-text";
import { LeadForm } from "./lead-form";

function A({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return href.startsWith("/") ? (
    <Link href={href} className={className}>{children}</Link>
  ) : (
    <a href={href} className={className}>{children}</a>
  );
}

export function BlockView({ block, siteId, pagePath, isFirst, h1 }: { block: Block; siteId: string; pagePath: string; isFirst: boolean; h1?: string }) {
  switch (block.type) {
    case "hero":
      return (
        <section id={block.id} className="bg-site-primary text-white">
          <div className="mx-auto grid max-w-6xl gap-8 px-6 py-20 md:grid-cols-2 md:items-center">
            <div>
              {/* The first hero carries the page H1; its own heading becomes the tagline. */}
              {h1 ? (
                <>
                  <h1 className="text-3xl font-bold leading-tight md:text-5xl">{h1}</h1>
                  <p className="mt-4 text-xl font-medium text-white/90">{block.heading}</p>
                </>
              ) : (
                <p className="text-3xl font-bold leading-tight md:text-4xl">{block.heading}</p>
              )}
              {block.subheading && <p className="mt-4 text-lg text-white/85">{block.subheading}</p>}
              <A href={block.ctaHref} className="mt-8 inline-block rounded-md bg-site-accent px-6 py-3 font-semibold text-slate-900 shadow">
                {block.ctaText}
              </A>
            </div>
            {block.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={block.image.src} alt={block.image.alt} className="w-full rounded-xl shadow-lg" loading={isFirst ? "eager" : "lazy"} />
            )}
          </div>
        </section>
      );
    case "rich_text":
      return (
        <section id={block.id} className="mx-auto max-w-3xl px-6 py-10 prose-site">
          {block.heading && <h2>{block.heading}</h2>}
          {block.paragraphs.map((p, i) => (
            <p key={i}><InlineText text={p} /></p>
          ))}
          {block.bullets && (
            <ul>
              {block.bullets.map((b, i) => (
                <li key={i}><InlineText text={b} /></li>
              ))}
            </ul>
          )}
        </section>
      );
    case "services_grid":
    case "features":
      return (
        <section id={block.id} className="bg-slate-50 py-14">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-2xl font-bold text-slate-900">{block.heading}</h2>
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {block.items.map((item, i) => {
                const href = "href" in item ? item.href : undefined;
                const inner = (
                  <>
                    <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
                    {href && <span className="mt-3 inline-block text-sm font-medium text-site-primary">Learn more →</span>}
                  </>
                );
                return href ? (
                  <A key={i} href={href} className="block rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md">{inner}</A>
                ) : (
                  <div key={i} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">{inner}</div>
                );
              })}
            </div>
          </div>
        </section>
      );
    case "faq":
      return (
        <section id={block.id} className="mx-auto max-w-3xl px-6 py-12">
          <h2 className="text-2xl font-bold text-slate-900">{block.heading}</h2>
          <div className="mt-6 divide-y divide-slate-200 border-y border-slate-200">
            {block.items.map((f, i) => (
              <details key={i} className="group py-4" open={i === 0}>
                <summary className="cursor-pointer list-none font-medium text-slate-900">{f.question}</summary>
                <p className="mt-2 text-slate-600 leading-7"><InlineText text={f.answer} /></p>
              </details>
            ))}
          </div>
        </section>
      );
    case "cta":
      return (
        <section id={block.id} className="bg-slate-900 py-14 text-white">
          <div className="mx-auto max-w-4xl px-6 text-center">
            <h2 className="text-2xl font-bold">{block.heading}</h2>
            {block.text && <p className="mt-3 text-white/80">{block.text}</p>}
            <A href={block.buttonHref} className="mt-6 inline-block rounded-md bg-site-accent px-6 py-3 font-semibold text-slate-900">{block.buttonText}</A>
          </div>
        </section>
      );
    case "testimonials":
      return (
        <section id={block.id} className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="text-2xl font-bold text-slate-900">{block.heading}</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {block.items.map((t, i) => (
              <figure key={i} className="rounded-xl border border-slate-200 p-6">
                <blockquote className="text-slate-700">“{t.quote}”</blockquote>
                <figcaption className="mt-4 text-sm font-medium text-slate-900">
                  {t.author}{t.location && <span className="font-normal text-slate-500">, {t.location}</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      );
    case "contact_form":
      return (
        <section id={block.id} className="mx-auto max-w-2xl px-6 py-14">
          <h2 className="text-2xl font-bold text-slate-900">{block.heading}</h2>
          {block.text && <p className="mt-2 text-slate-600">{block.text}</p>}
          <LeadForm siteId={siteId} pagePath={pagePath} />
        </section>
      );
    case "areas_served":
      return (
        <section id={block.id} className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="text-2xl font-bold text-slate-900">{block.heading}</h2>
          <ul className="mt-6 flex flex-wrap gap-2">
            {block.areas.map((a, i) => (
              <li key={i}>
                {a.href ? (
                  <A href={a.href} className="inline-block rounded-full border border-slate-300 px-4 py-1.5 text-sm hover:border-site-primary">{a.name}</A>
                ) : (
                  <span className="inline-block rounded-full border border-slate-200 px-4 py-1.5 text-sm text-slate-600">{a.name}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      );
    case "image":
      return (
        <figure id={block.id} className="mx-auto max-w-4xl px-6 py-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.src} alt={block.alt} className="w-full rounded-xl" loading="lazy" />
          {block.caption && <figcaption className="mt-2 text-center text-sm text-slate-500">{block.caption}</figcaption>}
        </figure>
      );
  }
}
