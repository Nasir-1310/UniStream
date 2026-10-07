'use client'
// components/admin/AdminLogin.tsx
//
// Sign-in with the server's ADMIN_SECRET. The secret is verified with a real
// request (the overview) before it is stored, and only for this browser tab.

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LogIn, ShieldCheck } from 'lucide-react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { Alert, PasswordInput, Spinner } from '@/components/ui'
import { adminOverview, apiErrorMessage, apiErrorStatus, warmBackend } from '@/lib/api'

export function AdminLogin({ notice, onSignedIn }: { notice: string | null; onSignedIn: (secret: string) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const slowTimer = useRef<number | undefined>(undefined)

  // Start waking a sleeping free-tier API while the admin types.
  useEffect(() => {
    warmBackend()
    return () => window.clearTimeout(slowTimer.current)
  }, [])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const secret = value.trim()
    if (!secret) {
      setError('Enter the admin secret.')
      inputRef.current?.focus()
      return
    }
    setError(null)
    setBusy(true)
    setSlow(false)
    window.clearTimeout(slowTimer.current)
    slowTimer.current = window.setTimeout(() => setSlow(true), 6000)
    try {
      await adminOverview(secret)
      onSignedIn(secret)
    } catch (err) {
      const status = apiErrorStatus(err)
      setError(
        status === 401
          ? 'That secret isn’t correct. Check ADMIN_SECRET on the server and try again.'
          : apiErrorMessage(err, 'Could not sign in. Please try again.'),
      )
      setBusy(false)
      // Focus after React re-enables the input.
      window.setTimeout(() => inputRef.current?.select(), 0)
    } finally {
      window.clearTimeout(slowTimer.current)
      setSlow(false)
    }
  }

  return (
    <div className="min-h-svh flex flex-col bg-[#0d0f1a]">
      <Navbar showAuth={false} homeHref="/" />
      <main id="main" className="relative flex-1 flex items-start sm:items-center justify-center px-4 py-10 sm:py-16 overflow-hidden">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[520px] max-w-full h-[360px] rounded-full bg-indigo-600/10 blur-[110px]" />
        </div>

        <div className="relative w-full max-w-sm">
          <div className="flex flex-col items-center text-center mb-6">
            <span className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-900/50">
              <ShieldCheck className="w-7 h-7 text-white" aria-hidden="true" />
            </span>
            <h1 className="mt-4 text-2xl font-bold text-white">Admin dashboard</h1>
            <p className="mt-1.5 text-sm text-slate-400">Manage access requests, users, limits and download logs.</p>
          </div>

          <div className="surface-card p-5 sm:p-6 shadow-2xl shadow-black/40">
            {notice && (
              <Alert tone="warning" className="mb-4">
                {notice}
              </Alert>
            )}
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              {/* Lets password managers file the secret under a recognisable name. */}
              <input type="text" name="username" autoComplete="username" value="admin" readOnly hidden />
              <PasswordInput
                ref={inputRef}
                id="admin-secret"
                label="Admin secret"
                autoComplete="current-password"
                autoFocus
                value={value}
                disabled={busy}
                onChange={event => {
                  setValue(event.target.value)
                  if (error) setError(null)
                }}
                error={error}
                hint="The ADMIN_SECRET value set on the server."
              />
              <button type="submit" disabled={busy} className="btn-primary w-full">
                {busy ? <Spinner size="sm" label={null} /> : <LogIn className="w-4 h-4" aria-hidden="true" />}
                {busy ? 'Checking…' : 'Sign in'}
              </button>
              <div aria-live="polite" className="empty:hidden">
                {slow && (
                  <p className="text-xs text-slate-400 text-center">
                    Waking up the server — this can take up to a minute after a quiet period.
                  </p>
                )}
              </div>
            </form>
          </div>

          <p className="mt-4 text-center text-xs text-slate-500 leading-relaxed">
            The secret is kept only in this browser tab and forgotten when you close it. Repeated wrong attempts are blocked
            for 15 minutes.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  )
}
