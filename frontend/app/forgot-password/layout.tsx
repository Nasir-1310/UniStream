// frontend/app/forgot-password/layout.tsx
// The page is a client component, which can't export metadata; this segment
// layout gives the route its tab title.
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Forgot password',
  description: 'Get a link to reset your UniStream Saver password.',
}

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children
}
