import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Generated client sites are served by this same app (see src/middleware.ts),
  // so images can come from any client-provided host.
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  serverExternalPackages: ["cheerio"],
};

export default nextConfig;
