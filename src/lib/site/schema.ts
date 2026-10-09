import { z } from "zod";

// Generated websites are stored as typed blocks, never as raw HTML or code. The AI writes
// JSON that must validate against these schemas; the renderer turns it into markup.
// Inline text may contain internal links using markdown syntax: [anchor text](/slug).

const text = (max: number) => z.string().trim().min(1).max(max);
const href = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v.startsWith("/") || v.startsWith("#") || /^https?:\/\//.test(v) || v.startsWith("tel:") || v.startsWith("mailto:"), {
    message: "href must be a relative path, #anchor, http(s), tel: or mailto: URL",
  });

export const blockId = z.string().regex(/^[a-z0-9_-]{1,40}$/, "block id must be short, lowercase, url-safe");

export const heroBlock = z.object({
  id: blockId,
  type: z.literal("hero"),
  heading: text(120),
  subheading: z.string().max(300).default(""),
  ctaText: z.string().max(40).default("Get a free quote"),
  ctaHref: href.default("/contact"),
  image: z.object({ src: z.string().url(), alt: z.string().max(200) }).optional(),
});

export const richTextBlock = z.object({
  id: blockId,
  type: z.literal("rich_text"),
  heading: z.string().max(140).optional(),
  paragraphs: z.array(text(2000)).min(1).max(20),
  bullets: z.array(text(300)).max(20).optional(),
});

export const servicesGridBlock = z.object({
  id: blockId,
  type: z.literal("services_grid"),
  heading: text(140),
  items: z
    .array(z.object({ title: text(80), description: text(400), href: href.optional() }))
    .min(1)
    .max(24),
});

export const featuresBlock = z.object({
  id: blockId,
  type: z.literal("features"),
  heading: text(140),
  items: z.array(z.object({ title: text(80), description: text(300) })).min(1).max(12),
});

export const faqBlock = z.object({
  id: blockId,
  type: z.literal("faq"),
  heading: z.string().max(140).default("Frequently asked questions"),
  items: z.array(z.object({ question: text(200), answer: text(1200) })).min(1).max(20),
});

export const ctaBlock = z.object({
  id: blockId,
  type: z.literal("cta"),
  heading: text(140),
  text: z.string().max(400).default(""),
  buttonText: z.string().max(40).default("Contact us"),
  buttonHref: href.default("/contact"),
});

export const testimonialsBlock = z.object({
  id: blockId,
  type: z.literal("testimonials"),
  heading: z.string().max(140).default("What our customers say"),
  items: z.array(z.object({ quote: text(600), author: text(80), location: z.string().max(80).optional() })).min(1).max(12),
});

export const contactFormBlock = z.object({
  id: blockId,
  type: z.literal("contact_form"),
  heading: z.string().max(140).default("Get in touch"),
  text: z.string().max(400).default(""),
});

export const areasServedBlock = z.object({
  id: blockId,
  type: z.literal("areas_served"),
  heading: text(140),
  areas: z.array(z.object({ name: text(80), href: href.optional() })).min(1).max(60),
});

export const imageBlock = z.object({
  id: blockId,
  type: z.literal("image"),
  src: z.string().url(),
  alt: z.string().max(200).default(""),
  caption: z.string().max(200).optional(),
});

export const block = z.discriminatedUnion("type", [
  heroBlock,
  richTextBlock,
  servicesGridBlock,
  featuresBlock,
  faqBlock,
  ctaBlock,
  testimonialsBlock,
  contactFormBlock,
  areasServedBlock,
  imageBlock,
]);

export type Block = z.infer<typeof block>;
export type BlockType = Block["type"];

export const blocks = z.array(block).max(40);

export const pageTypes = ["home", "service", "location", "service_location", "blog", "about", "contact", "other"] as const;

export const slugSchema = z
  .string()
  .trim()
  .regex(/^(|[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*)$/, "slug must be lowercase words separated by hyphens");

export const pageContent = z.object({
  slug: slugSchema,
  type: z.enum(pageTypes),
  title: text(70),
  meta_description: text(170),
  h1: text(120),
  target_keyword: z.string().max(120).nullable().optional(),
  blocks,
});

export type PageContent = z.infer<typeof pageContent>;

/** Page shape the renderer and change engine work with (a DB row subset). */
export interface PageState extends PageContent {
  id: string;
  status: "draft" | "published" | "archived";
  noindex: boolean;
  version: number;
}

export function parseBlocks(raw: unknown): Block[] {
  const parsed = blocks.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** Plain text of a page, used for word counts, keyword checks and AI context. */
export function pageText(page: Pick<PageContent, "h1" | "blocks">): string {
  const parts: string[] = [page.h1];
  for (const b of page.blocks) {
    switch (b.type) {
      case "hero":
        parts.push(b.heading, b.subheading);
        break;
      case "rich_text":
        parts.push(b.heading ?? "", ...b.paragraphs, ...(b.bullets ?? []));
        break;
      case "services_grid":
      case "features":
        parts.push(b.heading, ...b.items.flatMap((i) => [i.title, i.description]));
        break;
      case "faq":
        parts.push(b.heading, ...b.items.flatMap((i) => [i.question, i.answer]));
        break;
      case "cta":
        parts.push(b.heading, b.text);
        break;
      case "testimonials":
        parts.push(...b.items.map((i) => i.quote));
        break;
      case "areas_served":
        parts.push(b.heading, ...b.areas.map((a) => a.name));
        break;
      default:
        break;
    }
  }
  return parts
    .filter(Boolean)
    .join("\n")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Internal link targets (paths) referenced anywhere in a page's blocks. */
export function internalLinks(page: Pick<PageContent, "blocks">): string[] {
  const out = new Set<string>();
  const scan = (s: string | undefined) => {
    if (!s) return;
    for (const m of s.matchAll(LINK_RE)) if (m[2]!.startsWith("/")) out.add(m[2]!);
  };
  for (const b of page.blocks) {
    if (b.type === "rich_text") [...b.paragraphs, ...(b.bullets ?? [])].forEach(scan);
    if (b.type === "faq") b.items.forEach((i) => scan(i.answer));
    if (b.type === "services_grid") b.items.forEach((i) => i.href?.startsWith("/") && out.add(i.href));
    if (b.type === "areas_served") b.areas.forEach((a) => a.href?.startsWith("/") && out.add(a.href));
    if (b.type === "hero" && b.ctaHref.startsWith("/")) out.add(b.ctaHref);
    if (b.type === "cta" && b.buttonHref.startsWith("/")) out.add(b.buttonHref);
  }
  return [...out].map((p) => p.split("#")[0]!.replace(/\/$/, "") || "/");
}

export function pathForSlug(slug: string): string {
  return slug ? `/${slug}` : "/";
}
