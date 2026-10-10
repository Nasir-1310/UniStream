'use client'
// components/admin/AdminApp.tsx
//
// Entry point of /admin, driven by the admin session in lib/adminAuth:
//   signed out                  → sign-in screen (with "Session expired" after a 401)
//   signed in with the setup    → "Set your admin username and password" first
//     password (bootstrap)
//   signed in                   → the dashboard
// A 401 from any admin call clears the session in lib/api, which brings this
// back to the sign-in screen in place.

import { useCallback, useEffect, useState } from 'react'
import Navbar from '@/components/Navbar'
import { PageLoader } from '@/components/ui'
import { adminMe, type AdminAuthResponse, type AdminMe } from '@/lib/api'
import { clearAdminSession, useAdminSession } from '@/lib/adminAuth'
import { AdminLogin } from './AdminLogin'
import { AdminSetup } from './AdminSetup'
import { AdminShell } from './AdminShell'

/** GET /admin/auth/me once per session token (recovery mode; keeps the must-change flag in sync). */
function useAdminMe(token: string | null): AdminMe | null {
  const [state, setState] = useState<{ token: string; me: AdminMe } | null>(null)
  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    adminMe({ signal: controller.signal }).then(
      me => setState({ token, me }),
      // A 401 already ended the session in lib/api; anything else just means
      // no recovery banner until the next sign-in.
      () => {},
    )
    return () => controller.abort()
  }, [token])
  return state && state.token === token ? state.me : null
}

export default function AdminApp() {
  const { ready, session, expiredMessage } = useAdminSession()
  const me = useAdminMe(session?.token ?? null)
  // The password the admin just signed in with, kept in memory (never stored)
  // so the forced setup form doesn't ask for it again. Bound to that session.
  const [setupPassword, setSetupPassword] = useState<{ token: string; password: string } | null>(null)

  // The admin panel keeps the dark English theme; the public site is light.
  // (app/layout.tsx sets it before the first paint; this covers in-app navigation.)
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = 'dark'
    return () => {
      root.dataset.theme = 'light'
    }
  }, [])

  const onSignedIn = useCallback((auth: AdminAuthResponse, password: string) => {
    setSetupPassword(auth.must_change_password ? { token: auth.token, password } : null)
  }, [])

  const signOut = useCallback(() => {
    setSetupPassword(null)
    clearAdminSession()
  }, [])

  if (!ready) {
    // Server render / hydration: web storage isn't readable yet.
    return (
      <div className="min-h-svh flex flex-col bg-[#0d0f1a]">
        <Navbar showAuth={false} homeHref="/" />
        <main id="main" className="flex-1">
          <PageLoader label="Loading admin…" />
        </main>
      </div>
    )
  }

  if (!session) return <AdminLogin notice={expiredMessage} onSignedIn={onSignedIn} />

  const recoveryMode = me?.recovery_mode ?? false
  if (session.must_change_password) {
    return (
      <AdminSetup
        session={session}
        recoveryMode={recoveryMode}
        initialCurrentPassword={setupPassword?.token === session.token ? setupPassword.password : ''}
        onDone={() => setSetupPassword(null)}
        onSignOut={signOut}
      />
    )
  }
  return <AdminShell session={session} recoveryMode={recoveryMode} onSignOut={signOut} />
}
