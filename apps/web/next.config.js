/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  experimental: { cpus: 1 },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${process.env.API_INTERNAL_URL || 'http://localhost:3001'}/api/v1/:path*` }];
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

module.exports = nextConfig;
