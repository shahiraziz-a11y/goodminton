import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import { FeedbackProvider } from '@/components/Feedback'
import { SITE_URL } from '@/lib/supabase/env'
import { PwaSetup } from '@/components/Pwa'
import './globals.css'

const geist = Geist({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-geist' })

export const metadata: Metadata = {
  // Link-preview images (og:image) are absolute URLs on the official address,
  // never on a protected *.vercel.app one that WhatsApp can't open.
  metadataBase: SITE_URL ? new URL(SITE_URL) : undefined,
  title: 'Goodminton',
  description: 'Badminton games of 4 or 8, never in between. First in are confirmed.',
  applicationName: 'Goodminton',
  appleWebApp: { capable: true, title: 'Goodminton', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' }, { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
}

export const viewport: Viewport = { themeColor: '#F1F0EC', width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={geist.variable}>
      <body>
        <FeedbackProvider>{children}</FeedbackProvider>
        <PwaSetup />
      </body>
    </html>
  )
}
