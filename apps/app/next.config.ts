import type { NextConfig } from "next";

const langgraphUrl = process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@copilotkit/runtime"],
  async rewrites() {
    // Thread-history REST lives on the agent; proxy it so the browser stays
    // same-origin (the chat runtime uses a server-side proxy the same way).
    return [
      {
        source: "/threads/:path*",
        destination: `${langgraphUrl}/threads/:path*`,
      },
    ];
  },
};

export default nextConfig;
