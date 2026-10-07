// frontend/app/admin/page.tsx
//
// Admin dashboard. The page itself is a Server Component only so it can set
// metadata (private, never indexed); everything interactive lives in
// components/admin, starting with AdminApp.
import type { Metadata } from 'next'
import AdminApp from '@/components/admin/AdminApp'

export const metadata: Metadata = {
  title: 'Admin',
  description: 'Manage access requests, users, daily limits and download history for UniStream Saver.',
  robots: { index: false, follow: false },
}

export default function AdminPage() {
  return <AdminApp />
}
