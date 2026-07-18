//forntend/next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['i.ytimg.com', 'img.youtube.com', 'scontent.fdac', 'cdn.pixabay.com'],
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  async rewrites() {
    const backendUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/:path*`,
      },
    ]
  },
}
module.exports = nextConfig
