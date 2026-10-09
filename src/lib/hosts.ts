// Host classification shared by middleware and the site renderer.
// The dashboard app is served on ROOT_DOMAIN (and app./www. variants); every other
// host is a generated client site: either <subdomain>.ROOT_DOMAIN or a custom domain.

export type HostKind = { kind: "app" } | { kind: "site"; subdomain: string } | { kind: "custom"; domain: string };

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

export function classifyHost(rawHost: string, rootDomain: string): HostKind {
  const host = normalizeHost(rawHost);
  const root = normalizeHost(rootDomain);
  const bareRoot = root.split(":")[0]!;
  if (host === root || host === `app.${root}` || host === `www.${root}`) return { kind: "app" };
  // Local and preview deployments always serve the app.
  if (host.startsWith("127.0.0.1") || host.endsWith(".vercel.app") || host === bareRoot) return { kind: "app" };
  if (host.endsWith(`.${root}`)) {
    const sub = host.slice(0, -(root.length + 1));
    if (sub && !sub.includes(".")) return { kind: "site", subdomain: sub };
  }
  // A port-less match (e.g. ROOT_DOMAIN=localhost:3000 but request host has no port) is still ours.
  const hostNoPort = host.split(":")[0]!;
  if (hostNoPort.endsWith(`.${bareRoot}`)) {
    const sub = hostNoPort.slice(0, -(bareRoot.length + 1));
    if (sub && !sub.includes(".")) return { kind: "site", subdomain: sub };
  }
  return { kind: "custom", domain: hostNoPort.replace(/^www\./, "") };
}

export function siteUrl(site: { subdomain: string; custom_domain: string | null; domain_verified: boolean }, rootDomain: string, appUrl: string): string {
  const protocol = appUrl.startsWith("https") ? "https" : "http";
  if (site.custom_domain && site.domain_verified) return `https://${site.custom_domain}`;
  return `${protocol}://${site.subdomain}.${rootDomain}`;
}

/**
 * In local development generated sites live on *.localhost, which Node cannot always
 * resolve. Map such URLs to the equivalent internal renderer path on the app origin.
 */
export function fetchableUrl(url: string, rootDomain: string, appUrl: string): string {
  const u = new URL(url);
  const kind = classifyHost(u.host, rootDomain);
  if (kind.kind === "site" && /localhost|127\.0\.0\.1/.test(rootDomain)) {
    return `${appUrl.replace(/\/$/, "")}/sites/sub~${kind.subdomain}${u.pathname === "/" ? "" : u.pathname}`;
  }
  return url;
}
