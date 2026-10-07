// frontend/app/download/layout.tsx
// Tab title for the client-rendered download page; private, so not indexed.
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Download videos',
  description: 'Analyze a YouTube, Facebook or Instagram link and download it in the quality you need.',
  robots: { index: false, follow: false },
}

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return children
}
