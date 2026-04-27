/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@stockcentral/types'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.amazonaws.com' },
      { protocol: 'https', hostname: '**.cloudflare.com' },
    ],
  },
}

module.exports = nextConfig
