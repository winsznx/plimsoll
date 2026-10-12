import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@plimsoll/domain", "@plimsoll/stellar", "@plimsoll/documents"],
  serverExternalPackages: ["@stellar/stellar-sdk", "pg", "unpdf", "pdf-lib"],
  typedRoutes: false,
  poweredByHeader: false,
  outputFileTracingIncludes: { "/**": ["./drizzle/**"] },
  agentRules: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
