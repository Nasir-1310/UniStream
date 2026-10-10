// frontend/app/download/layout.tsx
// Tab title for the client-rendered download page; private, so not indexed.
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'ভিডিও ডাউনলোড',
  description: 'YouTube, Facebook বা Instagram-এর লিংক পেস্ট করুন, কোয়ালিটি বেছে নিন, আর ভিডিও বা শুধু অডিও (MP3) ডাউনলোড করুন।',
  robots: { index: false, follow: false },
}

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return children
}
