// frontend/app/reset-password/layout.tsx
// Tab title for the client-rendered page. The URL carries a one-time reset
// token, so never send it as a Referer and keep the page out of search results.
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Set a new password',
  description: 'Choose a new password for your UniStream Saver account and sign in.',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
}

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children
}
