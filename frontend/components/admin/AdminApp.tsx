'use client'
// components/admin/AdminApp.tsx
//
// Entry point of /admin: the sign-in screen until a working secret is
// stored for this tab, then the dashboard. A secret the server later
// rejects (401, e.g. ADMIN_SECRET was rotated) returns here with a notice.

import { useCallback, useState } from 'react'
import Navbar from '@/components/Navbar'
import { PageLoader } from '@/components/ui'
import { AdminLogin } from './AdminLogin'
import { AdminShell } from './AdminShell'
import { useAdminSecret, writeAdminSecret } from './secret'

export default function AdminApp() {
  const secret = useAdminSecret()
  const [notice, setNotice] = useState<string | null>(null)

  const signIn = useCallback((value: string) => {
    setNotice(null)
    writeAdminSecret(value)
  }, [])

  const signOut = useCallback((expired: boolean) => {
    setNotice(expired ? 'The server no longer accepts this admin secret. Sign in again with the current one.' : null)
    writeAdminSecret(null)
  }, [])

  if (secret === undefined) {
    // Server render / hydration: sessionStorage isn't readable yet.
    return (
      <div className="min-h-svh flex flex-col bg-[#0d0f1a]">
        <Navbar showAuth={false} homeHref="/" />
        <main id="main" className="flex-1">
          <PageLoader label="Loading admin…" />
        </main>
      </div>
    )
  }

  if (!secret) return <AdminLogin notice={notice} onSignedIn={signIn} />
  return <AdminShell secret={secret} onSignOut={signOut} />
}
