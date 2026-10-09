import Link from "next/link";
import type { BusinessInfo, Theme } from "@/lib/db/types";
import { pathForSlug, type PageState } from "@/lib/site/schema";
import { siteNavigation } from "@/lib/site/navigation";
import { jsonLdFor } from "@/lib/site/structured-data";
import { BlockView } from "./blocks";

type Props = {
  site: { id: string; theme: Theme; business: BusinessInfo };
  pages: PageState[];
  page: PageState;
  baseUrl: string;
  linkPrefix?: string; // used by the staff preview, which lives under /preview/<siteId>
  banner?: React.ReactNode;
};

export function SitePage({ site, pages, page, baseUrl, linkPrefix = "", banner }: Props) {
  const nav = siteNavigation(pages);
  const { about, contact } = nav;
  const b = site.business;
  const href = (p: PageState) => `${linkPrefix}${pathForSlug(p.slug)}`;
  const firstIsHero = page.blocks[0]?.type === "hero";
  const style = {
    "--site-primary": site.theme.primary ?? "#1d4ed8",
    "--site-accent": site.theme.accent ?? "#f59e0b",
  } as React.CSSProperties;

  return (
    <div className={`site-root min-h-screen ${site.theme.font === "serif" ? "font-serif" : "font-sans"}`} style={style}>
      {banner}
      {jsonLdFor(page, b, baseUrl).map((ld, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      ))}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link href={linkPrefix || "/"} className="text-lg font-bold text-site-primary">{site.theme.logoText ?? b.name}</Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-700 md:flex">
            {nav.header.filter((p) => p.type === "service").map((p) => (
              <Link key={p.id} href={href(p)} className="whitespace-nowrap hover:text-site-primary">{navLabel(p)}</Link>
            ))}
            {about && <Link href={href(about)} className="hover:text-site-primary">About</Link>}
            {contact && <Link href={href(contact)} className="hover:text-site-primary">Contact</Link>}
          </nav>
          {b.phone && (
            <a href={`tel:${b.phone.replace(/\s+/g, "")}`} className="rounded-md bg-site-primary px-4 py-2 text-sm font-semibold text-white">
              Call {b.phone}
            </a>
          )}
        </div>
      </header>

      <main>
        {!firstIsHero && (
          <div className="bg-slate-50 border-b border-slate-200">
            <div className="mx-auto max-w-6xl px-6 py-12">
              <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">{page.h1}</h1>
            </div>
          </div>
        )}
        {page.blocks.map((block, i) => (
          <BlockView key={block.id} block={block} siteId={site.id} pagePath={pathForSlug(page.slug)} isFirst={i === 0} h1={i === 0 && firstIsHero ? page.h1 : undefined} />
        ))}
      </main>

      <footer className="mt-12 border-t border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 text-sm md:grid-cols-4">
          <div>
            <p className="font-semibold text-slate-900">{b.name}</p>
            {b.address && <p className="mt-2 text-slate-600">{b.address}</p>}
            {b.phone && <p className="mt-1 text-slate-600">{b.phone}</p>}
            {b.email && <p className="mt-1 text-slate-600">{b.email}</p>}
            {b.hours && <p className="mt-1 text-slate-500">{b.hours}</p>}
          </div>
          <FooterLinks title="Services" pages={nav.footer.services} href={href} />
          <FooterLinks title="Areas we cover" pages={nav.footer.locations} href={href} />
          <FooterLinks title="Advice" pages={nav.footer.blog} href={href} />
        </div>
        <p className="pb-8 text-center text-xs text-slate-400">© {new Date().getFullYear()} {b.name}</p>
      </footer>
    </div>
  );
}

/** Short header label: "Boiler Repair in Birmingham" -> "Boiler Repair". */
function navLabel(p: PageState) {
  const short = p.h1.replace(/\s+(in|near|across)\s+.+$/i, "").trim();
  return short.length >= 3 && short.length <= 28 ? short : p.title.split("|")[0]!.trim().slice(0, 28);
}

function FooterLinks({ title, pages, href }: { title: string; pages: PageState[]; href: (p: PageState) => string }) {
  if (!pages.length) return <div />;
  return (
    <div>
      <p className="font-semibold text-slate-900">{title}</p>
      <ul className="mt-2 space-y-1">
        {pages.map((p) => (
          <li key={p.id}><Link href={href(p)} className="text-slate-600 hover:text-site-primary">{p.h1}</Link></li>
        ))}
      </ul>
    </div>
  );
}
