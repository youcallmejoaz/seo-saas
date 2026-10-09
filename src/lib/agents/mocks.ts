// Deterministic stand-ins for model output, used when AI_MOCK=1 or no API key is set.
// They let the whole pipeline (generation, campaigns, approvals) run in dev and CI
// without spending quota, and they produce content that passes the same validation.
import type { BusinessInfo } from "@/lib/db/types";
import type { Block } from "@/lib/site/schema";
import { pathForSlug } from "@/lib/site/schema";
import { slugify } from "@/lib/utils";
import type { PagePlan, SitePlan } from "./site-builder";

const lc = (s: string) => s.toLowerCase();
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function mockSitePlan(b: BusinessInfo, maxCombos: number): SitePlan {
  const primary = b.locations[0] ?? "your area";
  const brand = b.name;
  const pages: PagePlan[] = [
    {
      slug: "",
      type: "home",
      title: `${title(b.industry ?? b.services[0] ?? "Local services")} in ${primary} | ${brand}`.slice(0, 60),
      h1: `${title(b.industry ?? b.services[0] ?? "Trusted local services")} in ${primary}`,
      meta_description: `${brand} provides ${b.services.slice(0, 3).map(lc).join(", ")} across ${primary}. Fast response, fair prices and friendly local experts. Get a free quote today.`.slice(0, 158),
      target_keyword: `${lc(b.industry ?? b.services[0] ?? "services")} ${lc(primary)}`,
      brief: "Overview of the business and every service, with clear calls to action.",
    },
    { slug: "about", type: "about", title: `About ${brand} | Local ${title(b.industry ?? "Experts")}`.slice(0, 60), h1: `About ${brand}`, meta_description: `Meet the team at ${brand}. Learn how we work, the areas we cover and why customers across ${primary} choose us.`, target_keyword: `${lc(brand)}`, brief: "Who we are." },
    { slug: "contact", type: "contact", title: `Contact ${brand} | Free Quotes in ${primary}`.slice(0, 60), h1: `Contact ${brand}`, meta_description: `Get in touch with ${brand} for a free, no-obligation quote. Call us or send an enquiry and we'll respond quickly.`, target_keyword: `${lc(brand)} contact`, brief: "Contact details." },
  ];
  for (const s of b.services) {
    pages.push({
      slug: slugify(s),
      type: "service",
      title: `${title(s)} in ${primary} | ${brand}`.slice(0, 60),
      h1: `${title(s)} in ${primary}`,
      meta_description: `Professional ${lc(s)} in ${primary} from ${brand}. Experienced, reliable and fairly priced. Call now for a free quote.`.slice(0, 158),
      target_keyword: `${lc(s)} ${lc(primary)}`,
      service: s,
      brief: `Explain our ${lc(s)} service.`,
    });
  }
  // The home page already targets the primary location, so area pages cover the rest.
  for (const l of b.locations.slice(1)) {
    pages.push({
      slug: `areas/${slugify(l)}`,
      type: "location",
      title: `${title(b.industry ?? "Local services")} in ${l} | ${brand}`.slice(0, 60),
      h1: `${title(b.industry ?? "Our services")} in ${l}`,
      meta_description: `Looking for a trusted ${lc(b.industry ?? "local business")} in ${l}? ${brand} covers ${l} and nearby areas. Call for a free quote.`.slice(0, 158),
      target_keyword: `${lc(b.industry ?? b.services[0] ?? "services")} ${lc(l)}`,
      location: l,
      brief: `Local page for ${l}.`,
    });
  }
  let combos = 0;
  for (const l of b.locations.slice(0, 2)) {
    for (const s of b.services) {
      if (combos >= maxCombos) break;
      if (l === primary) continue; // the service page already targets the primary location
      pages.push({
        slug: `${slugify(s)}-${slugify(l)}`,
        type: "service_location",
        title: `${title(s)} ${l} | ${brand}`.slice(0, 60),
        h1: `${title(s)} in ${l}`,
        meta_description: `Need ${lc(s)} in ${l}? ${brand} offers fast, reliable ${lc(s)} across ${l}. Call today for a free, no-obligation quote.`.slice(0, 158),
        target_keyword: `${lc(s)} ${lc(l)}`,
        service: s,
        location: l,
        brief: `${s} for customers in ${l}.`,
      });
      combos++;
    }
  }
  return {
    theme: { primary: "#1e3a8a", accent: "#fbbf24", font: "sans", logoText: brand },
    pages,
  };
}

function paragraphs(b: BusinessInfo, topic: string, place: string, n: number): string[] {
  const usp = b.usp?.length ? b.usp.join(", ").toLowerCase() : "clear pricing, tidy work and friendly, qualified staff";
  const bank = [
    `${b.name} provides ${lc(topic)} for homes and businesses in ${place}. Every job starts with a clear explanation of what needs doing and a written quote, so you know exactly where you stand before any work begins.`,
    `Customers choose us for ${usp}. We turn up when we say we will, protect your property while we work, and leave everything clean and tidy when the job is done.`,
    `Our ${lc(topic)} service covers everything from quick fixes to larger projects. If something is beyond repair we will tell you honestly and talk you through the options, rather than recommending work you do not need.`,
    `Because we are based locally, we can usually reach addresses across ${place} quickly. That means less disruption for you and a faster route back to normal.`,
    `All of our work is carried out to current standards and backed by a workmanship guarantee. If anything is not right, just call us and we will put it right.`,
    `Not sure what you need? Give us a call and describe the problem. We are happy to offer straightforward advice over the phone, and if a visit is needed we will arrange a time that suits you.`,
  ];
  return Array.from({ length: n }, (_, i) => bank[i % bank.length]!);
}

export function mockPageBlocks(b: BusinessInfo, plan: SitePlan, page: PagePlan): Block[] {
  const place = page.location ?? b.locations[0] ?? "your area";
  const topic = page.service ?? b.industry ?? b.services[0] ?? "our services";
  const services = plan.pages.filter((p) => p.type === "service");
  const locations = plan.pages.filter((p) => p.type === "location");
  const contact = plan.pages.find((p) => p.type === "contact");
  const linkTo = (p: PagePlan | undefined, anchor: string) => (p ? `[${anchor}](${pathForSlug(p.slug)})` : anchor);
  const hero: Block = {
    id: "hero",
    type: "hero",
    heading: page.type === "home" ? `Reliable ${lc(topic)} you can count on` : `Trusted ${lc(topic)} in ${place}`,
    subheading: `Local, friendly and fully insured. ${b.phone ? `Call ${b.phone} for a free quote.` : "Get a free, no-obligation quote today."}`,
    ctaText: "Get a free quote",
    ctaHref: contact ? pathForSlug(contact.slug) : "/contact",
  };
  const cta: Block = { id: "cta", type: "cta", heading: `Need ${lc(topic)} in ${place}?`, text: "Speak to our friendly team today for fast, honest advice and a free quote.", buttonText: "Contact us", buttonHref: contact ? pathForSlug(contact.slug) : "/contact" };
  const faq: Block = {
    id: "faq",
    type: "faq",
    heading: "Frequently asked questions",
    items: [
      { question: `How quickly can you help with ${lc(topic)} in ${place}?`, answer: `We aim to respond the same day for urgent jobs in ${place} and can usually book routine work within a few days.` },
      { question: "Do you give free quotes?", answer: "Yes. We provide clear, written quotes before starting any work, with no obligation to go ahead." },
      { question: "Is your work guaranteed?", answer: "All of our work is covered by a workmanship guarantee. If something isn't right, we'll come back and fix it." },
      { question: "Which areas do you cover?", answer: `We cover ${b.locations.join(", ")} and the surrounding areas.` },
    ],
  };

  switch (page.type) {
    case "home":
      return [
        hero,
        { id: "intro", type: "rich_text", heading: `Welcome to ${b.name}`, paragraphs: [...paragraphs(b, topic, place, 3), `Explore our ${linkTo(services[0], lc(services[0]?.service ?? "services"))} or see the ${linkTo(locations[0], `areas we cover`)}.`] },
        { id: "services", type: "services_grid", heading: "Our services", items: services.map((s) => ({ title: s.service ?? s.h1, description: `Professional ${lc(s.service ?? s.h1)} carried out by experienced local specialists.`, href: pathForSlug(s.slug) })) },
        { id: "why-us", type: "features", heading: `Why choose ${b.name}`, items: [{ title: "Local and responsive", description: `Based in ${place}, so we can reach you quickly.` }, { title: "Honest pricing", description: "Clear written quotes with no hidden extras." }, { title: "Guaranteed work", description: "Every job is backed by our workmanship guarantee." }] },
        { id: "more", type: "rich_text", heading: "How we work", paragraphs: paragraphs(b, topic, place, 6).slice(3) },
        faq,
        cta,
      ];
    case "contact":
      return [
        hero,
        { id: "details", type: "rich_text", heading: "Get in touch", paragraphs: [[b.phone && `Phone: ${b.phone}`, b.email && `Email: ${b.email}`, b.address && `Address: ${b.address}`, b.hours && `Hours: ${b.hours}`].filter(Boolean).join(". ") || "Send us a message using the form below.", `We usually reply within one working day. For urgent help, please call. You can also browse our ${linkTo(services[0], "services")}.`] },
        { id: "contact-form", type: "contact_form", heading: "Send us an enquiry", text: "Tell us a little about what you need and we'll get back to you quickly." },
      ];
    case "about":
      return [hero, { id: "story", type: "rich_text", heading: `About ${b.name}`, paragraphs: [...paragraphs(b, topic, place, 4), `See ${linkTo(services[0], "what we do")} or ${linkTo(contact, "contact us")}.`] }, cta];
    default:
      return [
        hero,
        { id: "intro", type: "rich_text", heading: `${title(topic)} in ${place}`, paragraphs: [...paragraphs(b, topic, place, 4), `Get in touch via our ${linkTo(contact, "contact page")} for a free quote.`] },
        { id: "included", type: "rich_text", heading: "What's included", paragraphs: paragraphs(b, topic, place, 6).slice(4), bullets: ["Free, no-obligation quotes", "Fully insured, qualified staff", "Workmanship guarantee", "Tidy, respectful work"] },
        { id: "why-us", type: "features", heading: `Why choose ${b.name}`, items: [{ title: "Fast response", description: `Quick appointments across ${place}.` }, { title: "Clear pricing", description: "You'll know the cost before we start." }, { title: "Local experts", description: "Experienced specialists who know the area." }] },
        faq,
        cta,
      ];
  }
}
