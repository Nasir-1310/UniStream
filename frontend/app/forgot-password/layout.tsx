// frontend/app/forgot-password/layout.tsx
// The page is a client component, which can't export metadata; this segment
// layout gives the route its tab title.
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'পাসওয়ার্ড ভুলে গেছেন',
  description: 'নতুন UniStream Saver পাসওয়ার্ড সেট করার লিংক ইমেইলে পান।',
}

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children
}
