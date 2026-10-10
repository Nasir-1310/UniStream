// frontend/app/layout.tsx
import type { Metadata, Viewport } from 'next'
import { ToastProvider } from '@/components/ui/Toast'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'
import './globals.css'

// Shared by every page that doesn't set its own; also the landing page's
// metadata (it's a client component, so it can't export any).
const description =
  'YouTube, Facebook ও Instagram ভিডিও 4K পর্যন্ত কোয়ালিটিতে, বা শুধু অডিও MP3 হিসেবে সেভ করুন। অনুমোদিত শিক্ষার্থীদের জন্য ফ্রি, অ্যাকাউন্ট অনুযায়ী প্রতিদিন আনলিমিটেড ডাউনলোড।'

export const metadata: Metadata = {
  title: {
    default: 'UniStream Saver: YouTube, Facebook ও Instagram ভিডিও ডাউনলোড',
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
    description: 'YouTube, Facebook ও Instagram ভিডিও 4K পর্যন্ত সেভ করুন। অনুমোদিত শিক্ষার্থীদের জন্য ফ্রি।',
    type: 'website',
    siteName: 'UniStream Saver',
  },
  formatDetection: {
    // Stop iOS turning phone numbers in the admin panel into call links.
    telephone: false,
  },
}

export const viewport: Viewport = {
  themeColor: '#fbf6ec',
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
    // The public site is Bangla on cream paper (data-theme="light"); the
    // admin panel stays English and dark. The inline script picks the theme
    // before the first paint, so /admin never flashes cream.
    <html lang="bn" data-theme="light" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "document.documentElement.dataset.theme=location.pathname.indexOf('/admin')===0?'dark':'light'",
          }}
        />
        {/* Preconnect for Google Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        {/*
          Anek Bangla — headings (modern, premium); Hind Siliguri — Bangla body
          text and its Latin; Source Sans 3 — the English admin panel.
        */}
        {/* App Router root layout is the document-level font declaration. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Anek+Bangla:wght@500;600;700;800&family=Hind+Siliguri:wght@400;500;600;700&family=Source+Sans+3:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="page-bg text-slate-200 antialiased min-h-svh">
        {/* Pages render <main id="main">; keyboard users can jump past the navbar. */}
        <a href="#main" className="skip-link">
          মূল অংশে যান
        </a>
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  )
}
