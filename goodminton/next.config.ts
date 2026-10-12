import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Always re-check the service worker so updates reach installed apps.
  headers: async () => [
    { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] },
  ],
}

export default nextConfig
