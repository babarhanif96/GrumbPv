import type { NextConfig } from "next";

const shouldDisableImageOptimization =
  process.env.NEXT_IMAGE_UNOPTIMIZED === "true";

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'dev.grumbuild.com',
        pathname: '/backend/uploads/**',
      },
      {
        protocol: 'https',
        hostname: 'www.dev.grumbuild.com',
        pathname: '/backend/uploads/**',
      },
      {
        protocol: 'https',
        hostname: 'grumbuild.com',
        pathname: '/backend/uploads/**',
      },
      {
        protocol: 'https',
        hostname: 'www.grumbuild.com',
        pathname: '/backend/uploads/**',
      },
      // Allow local backend in development
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '5000',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '5001',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: '127.0.0.1',
        port: '5000',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: '127.0.0.1',
        port: '5001',
        pathname: '/**',
      },
    ],
    // Avoid optimizer TLS/cert issues in local dev for remote assets.
    unoptimized:
      process.env.NODE_ENV === "development" || shouldDisableImageOptimization,
    // or simpler for a single host:
    // domains: ['knownothing0.xyz'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
