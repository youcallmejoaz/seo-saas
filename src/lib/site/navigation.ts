import { pathForSlug, type PageState } from "./schema";

/** Site-wide header/footer links. Shared by the renderer and SEO lint so both agree. */
export function siteNavigation(pages: PageState[]) {
  const live = pages.filter((p) => p.status !== "archived");
  const services = live.filter((p) => p.type === "service");
  const locations = live.filter((p) => p.type === "location" || p.type === "service_location");
  const blog = live.filter((p) => p.type === "blog");
  const about = live.find((p) => p.type === "about");
  const contact = live.find((p) => p.type === "contact");
  const header = [...services.slice(0, 5), ...(about ? [about] : []), ...(contact ? [contact] : [])];
  const footer = { services, locations: locations.slice(0, 12), blog: blog.slice(0, 8) };
  const linkedPaths = new Set([...header, ...footer.services, ...footer.locations, ...footer.blog].map((p) => pathForSlug(p.slug)));
  return { header, footer, about, contact, linkedPaths };
}
