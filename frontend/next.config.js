/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['i.ytimg.com', 'img.youtube.com', 'scontent.fdac', 'cdn.pixabay.com'],
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
}
module.exports = nextConfig
