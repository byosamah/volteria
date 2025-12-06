import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  // This creates a minimal production build with all dependencies bundled
  output: "standalone",
};

export default nextConfig;
