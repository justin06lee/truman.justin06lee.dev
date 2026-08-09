import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libsql ships native bindings that break at runtime if they're bundled.
  // The same list appears in justin06lee.dev and hours.justin06lee.dev.
  serverExternalPackages: ["@libsql/client", "libsql"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // The site is a camera pointed at a home. Nothing here should be
          // reachable from an embed, a crawler, or a prefetcher.
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
