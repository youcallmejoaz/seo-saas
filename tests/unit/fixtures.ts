import type { PageState } from "@/lib/site/schema";

export function page(over: Partial<PageState> & Pick<PageState, "id" | "slug">): PageState {
  return {
    type: "service",
    title: "Emergency Plumber Birmingham | Brum Plumbing Co",
    meta_description: "Fast, friendly emergency plumbing across Birmingham. Fixed prices, no call-out surprises. Call today for a free quote.",
    h1: "Emergency plumbing in Birmingham",
    target_keyword: "emergency plumber birmingham",
    status: "published",
    noindex: false,
    version: 1,
    blocks: [
      { id: "hero", type: "hero", heading: "Help when you need it", subheading: "", ctaText: "Call now", ctaHref: "/contact" },
      { id: "intro", type: "rich_text", paragraphs: ["We fix burst pipes and leaks fast. Our boiler repair team is also on call."] },
    ],
    ...over,
  };
}

export function site(): PageState[] {
  return [
    page({ id: "00000000-0000-4000-8000-000000000001", slug: "", type: "home", title: "Plumbers in Birmingham | Brum Plumbing Co", h1: "Plumbers in Birmingham", target_keyword: "plumber birmingham" }),
    page({ id: "00000000-0000-4000-8000-000000000002", slug: "emergency-plumbing" }),
    page({ id: "00000000-0000-4000-8000-000000000003", slug: "boiler-repair", title: "Boiler Repair Birmingham | Brum Plumbing Co", h1: "Boiler repair in Birmingham", target_keyword: "boiler repair birmingham" }),
    page({ id: "00000000-0000-4000-8000-000000000004", slug: "contact", type: "contact", title: "Contact Brum Plumbing Co | Free Quotes", h1: "Contact us", target_keyword: null }),
  ];
}
