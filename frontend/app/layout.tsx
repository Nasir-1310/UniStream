// frontend/app/layout.tsx
import type { Metadata, Viewport } from 'next'
import { ToastProvider } from '@/components/ui/Toast'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'
import './globals.css'

// Shared by every page that doesn't set its own; also the landing page's
// metadata (it's a client component, so it can't export any).
const description =
  'Save YouTube, Facebook and Instagram videos in up to 4K, or just the audio as MP3. Free for approved students, with unlimited downloads per day depending on your account.'

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
    description: 'Save YouTube, Facebook and Instagram videos in up to 4K. Free for approved students.',
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
          Source Sans 3 — one humanist sans for headings and body text, the
          clean journal look (titles semibold, labels italic).
        */}
        {/* App Router root layout is the document-level font declaration. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,600&display=swap"
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
