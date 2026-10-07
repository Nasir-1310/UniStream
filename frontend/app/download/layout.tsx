// frontend/app/download/layout.tsx
// Tab title for the client-rendered download page; private, so not indexed.
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Download a video',
  description: 'Paste a YouTube, Facebook or Instagram link, choose a quality and download the video or just the audio (MP3).',
  robots: { index: false, follow: false },
}

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return children
}
