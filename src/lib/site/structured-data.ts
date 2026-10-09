import type { BusinessInfo } from "@/lib/db/types";
import type { PageState } from "./schema";
import { pageText, pathForSlug } from "./schema";

/** schema.org JSON-LD for a page: LocalBusiness, Service, FAQPage and breadcrumbs. */
export function jsonLdFor(page: PageState, business: BusinessInfo, baseUrl: string): object[] {
  const url = `${baseUrl}${pathForSlug(page.slug)}`;
  const org = {
    "@type": "LocalBusiness",
    "@id": `${baseUrl}/#business`,
    name: business.name,
    url: baseUrl,
    ...(business.phone && { telephone: business.phone }),
    ...(business.email && { email: business.email }),
    ...(business.address && { address: { "@type": "PostalAddress", streetAddress: business.address } }),
    ...(business.hours && { openingHours: business.hours }),
    areaServed: business.locations.map((name) => ({ "@type": "City", name })),
  };
  const out: object[] = [{ "@context": "https://schema.org", ...org }];

  if (page.type === "service" || page.type === "service_location") {
    out.push({
      "@context": "https://schema.org",
      "@type": "Service",
      name: page.h1,
      serviceType: page.target_keyword ?? page.h1,
      provider: { "@id": `${baseUrl}/#business` },
      url,
      description: page.meta_description,
    });
  }

  const faqs = page.blocks.flatMap((b) => (b.type === "faq" ? b.items : []));
  if (faqs.length) {
    out.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: pageText({ h1: "", blocks: [{ id: "x", type: "rich_text", paragraphs: [f.answer] }] }).trim() },
      })),
    });
  }

  if (page.slug) {
    const parts = page.slug.split("/");
    out.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${baseUrl}/` },
        ...parts.map((_, i) => ({
          "@type": "ListItem",
          position: i + 2,
          name: i === parts.length - 1 ? page.h1 : parts[i],
          item: `${baseUrl}/${parts.slice(0, i + 1).join("/")}`,
        })),
      ],
    });
  }
  return out;
}
