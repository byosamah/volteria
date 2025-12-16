import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  // This creates a minimal production build with all dependencies bundled
  output: "standalone",

  // Image optimization: Use modern formats for smaller file sizes
  images: {
    // Prefer AVIF (smallest) then WebP (widely supported)
    formats: ["image/avif", "image/webp"],
    // Device breakpoints for responsive images
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    // Smaller sizes for icons and thumbnails
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },

  // Enable gzip compression for smaller response sizes
  compress: true,

  // Security: Don't advertise that we're using Next.js
  poweredByHeader: false,
};

export default nextConfig;
