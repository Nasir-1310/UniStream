// frontend/app/account/layout.tsx
// Tab title for the client-rendered account page; private, so not indexed.
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'অ্যাকাউন্ট',
  description: 'আপনার UniStream Saver তথ্য, আজকের ডাউনলোড আর পাসওয়ার্ড।',
  robots: { index: false, follow: false },
}

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return children
}
