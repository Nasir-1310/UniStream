// frontend/app/layout.tsx
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'UniStream Saver — University Video Downloader',
    template: '%s · UniStream Saver',
  },
  description:
    'Download videos from YouTube, Facebook, Instagram, and TikTok in HD or data-saving quality. Exclusively for approved university students.',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'UniStream Saver',
    description: 'University-exclusive video downloader for YouTube, Facebook, Instagram & TikTok.',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#23a567',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Preconnect for Google Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        {/*
          Space Grotesk — display / headings (geometric, personality)
          Inter — body / UI text (neutral, readable at all sizes)
        */}
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#0a0d14] text-slate-200 antialiased min-h-svh">
        {children}
      </body>
    </html>
  )
}