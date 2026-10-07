// frontend/app/account/layout.tsx
// Tab title for the client-rendered account page; private, so not indexed.
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Account',
  description: 'Your UniStream Saver details, downloads left today and password.',
  robots: { index: false, follow: false },
}

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return children
}
