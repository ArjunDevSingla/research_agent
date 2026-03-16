/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_GATEWAY_URL: process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8000',
    NEXT_PUBLIC_GATEWAY_WS:  process.env.NEXT_PUBLIC_GATEWAY_WS  || 'ws://localhost:8000',
  },
  async redirects() {
    return [
      {
        source:      '/',
        destination: '/landing',
        permanent:   false,
      },
    ]
  },
}

module.exports = nextConfig
