// frontend/app/layout.tsx
import type { Metadata, Viewport } from 'next'
import { ToastProvider } from '@/components/ui/Toast'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'
import './globals.css'

// Shared by every page that doesn't set its own; also the landing page's
// metadata (it's a client component, so it can't export any).
const description =
  'Save YouTube, Facebook and Instagram videos in up to 1080p HD, or just the audio as MP3. Free for approved students, with 4 downloads a day.'

export const metadata: Metadata = {
  title: {
    default: 'UniStream Saver: download YouTube, Facebook and Instagram videos',
    template: '%s · UniStream Saver',
  },
  description,
  applicationName: 'UniStream Saver',
  keywords: ['video downloader', 'YouTube downloader', 'Facebook video', 'Instagram reels', 'MP3', 'students', 'Bangladesh'],
  manifest: '/manifest.json',
  icons: {
    icon: '/unistream-icon.svg',
  },
  openGraph: {
    title: 'UniStream Saver',
    description: 'Save YouTube, Facebook and Instagram videos in up to 1080p HD. Free for approved students.',
    type: 'website',
    siteName: 'UniStream Saver',
  },
  formatDetection: {
    // Stop iOS turning phone numbers in the admin panel into call links.
    telephone: false,
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
        {/* App Router root layout is the document-level font declaration. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#0a0d14] text-slate-200 antialiased min-h-svh">
        {/* Pages render <main id="main">; keyboard users can jump past the navbar. */}
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  )
}
