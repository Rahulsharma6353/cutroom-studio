/** @type {import('next').NextConfig} */
const API = process.env.BACKEND_URL || 'http://127.0.0.1:4000';

const nextConfig = {
  reactStrictMode: true,
  // Compile the shared package (frame renderer, timeline model) from source.
  experimental: { externalDir: true, proxyTimeout: 30 * 60 * 1000 },
  // The browser talks to one origin; API calls, media and assets are proxied to the backend.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API}/api/:path*` },
      { source: '/sfx/:file', destination: `${API}/sfx/:file` },
      { source: '/brand/:file', destination: `${API}/brand/:file` },
    ];
  },
};

export default nextConfig;
