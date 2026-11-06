import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A minimal self-contained server (.next/standalone) for the Docker image.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // Uploads go through Server Actions; 10 MB files plus multipart overhead.
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
