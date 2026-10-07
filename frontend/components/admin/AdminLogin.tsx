'use client'
// components/admin/AdminLogin.tsx
//
// Admin sign-in with a username and password. The session is kept for this
// tab only, or for 7 days on this device with "Keep me signed in". The very
// first sign-in uses the setup password from the server (ADMIN_SECRET or
// ADMIN_PASSWORD); AdminApp then asks for a username and password of the
// admin's own.

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LogIn, ShieldCheck } from 'lucide-react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { Alert, Field, PasswordInput, Spinner, describedBy } from '@/components/ui'
import { adminLogin, apiErrorMessage, apiErrorStatus, warmBackend, type AdminAuthResponse } from '@/lib/api'
import { ADMIN_LOGIN_PASSWORD_MAX, ADMIN_LOGIN_USERNAME_MAX } from './adminValidation'

interface FormError {
  tone: 'danger' | 'warning'
  title?: string
  message: string
}

export function AdminLogin({
  notice,
  onSignedIn,
}: {
  /** Why the last session ended (shown as "Session expired"), or null. */
  notice: string | null
  /** Called after a successful sign-in, with the password that was used. */
  onSignedIn?: (auth: AdminAuthResponse, password: string) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({})
  const [formError, setFormError] = useState<FormError | null>(null)
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const slowTimer = useRef<number | undefined>(undefined)
  // Where focus goes once a failed request re-enables the form (the browser
  // drops focus from the disabled button while the request runs).
  const focusAfter = useRef<HTMLElement | null>(null)

  // Start waking a sleeping free-tier API while the admin types.
  useEffect(() => {
    warmBackend()
    return () => window.clearTimeout(slowTimer.current)
  }, [])

  useEffect(() => {
    const target = focusAfter.current
    if (busy || !target) return
    focusAfter.current = null
    target.focus()
    if (target instanceof HTMLInputElement) target.select()
  }, [busy])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const name = username.trim()
    const errors = {
      username: name ? undefined : 'Please enter your username.',
      password: password ? undefined : 'Please enter your password.',
    }
    setFieldErrors(errors)
    setFormError(null)
    if (errors.username || errors.password) {
      ;(errors.username ? usernameRef : passwordRef).current?.focus()
      return
    }

    setBusy(true)
    setSlow(false)
    window.clearTimeout(slowTimer.current)
    slowTimer.current = window.setTimeout(() => setSlow(true), 6000)
    try {
      const auth = await adminLogin(name, password, remember)
      // The stored session switches AdminApp to the next screen.
      onSignedIn?.(auth, password)
    } catch (err) {
      const status = apiErrorStatus(err)
      const message = apiErrorMessage(err, 'Could not sign in. Please try again.')
      if (status === 429) {
        setFormError({ tone: 'warning', title: 'Sign-in paused', message })
      } else if (status === 503) {
        setFormError({ tone: 'danger', title: 'Admin sign-in isn’t available', message })
      } else {
        setFormError({ tone: 'danger', message })
      }
      // Wrong details: select the password so it can be retyped straight away.
      focusAfter.current = status === 401 ? passwordRef.current : submitRef.current
      setBusy(false)
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
            <h1 className="mt-4 text-2xl font-bold text-white">Admin sign-in</h1>
            <p className="mt-1.5 text-sm text-slate-400">Manage access requests, users and daily limits.</p>
          </div>

          <div className="surface-card p-5 sm:p-6 shadow-2xl shadow-black/40">
            {notice && (
              <Alert tone="warning" title="Session expired" className="mb-4">
                {notice}
              </Alert>
            )}
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              <Field htmlFor="admin-username" label="Username" error={fieldErrors.username}>
                <input
                  ref={usernameRef}
                  id="admin-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  maxLength={ADMIN_LOGIN_USERNAME_MAX}
                  value={username}
                  disabled={busy}
                  onChange={event => {
                    setUsername(event.target.value)
                    if (fieldErrors.username) setFieldErrors(current => ({ ...current, username: undefined }))
                    setFormError(null)
                  }}
                  aria-invalid={fieldErrors.username ? true : undefined}
                  aria-describedby={describedBy('admin-username', fieldErrors.username)}
                  className={`input-field ${fieldErrors.username ? 'input-error' : ''}`}
                />
              </Field>
              <PasswordInput
                ref={passwordRef}
                id="admin-password"
                name="password"
                label="Password"
                autoComplete="current-password"
                maxLength={ADMIN_LOGIN_PASSWORD_MAX}
                value={password}
                disabled={busy}
                onChange={event => {
                  setPassword(event.target.value)
                  if (fieldErrors.password) setFieldErrors(current => ({ ...current, password: undefined }))
                  setFormError(null)
                }}
                error={fieldErrors.password}
              />

              <label className="flex cursor-pointer items-start gap-3 rounded-lg -mx-1 px-1 py-1">
                <input
                  type="checkbox"
                  checked={remember}
                  disabled={busy}
                  onChange={event => setRemember(event.target.checked)}
                  aria-describedby="admin-remember-hint"
                  className="mt-0.5 w-4 h-4 flex-shrink-0 accent-indigo-500"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-slate-200">Keep me signed in on this device</span>
                  <span id="admin-remember-hint" className="block text-xs text-slate-500">
                    For 7 days. Leave this off on a shared computer.
                  </span>
                </span>
              </label>

              <div aria-live="assertive" className="empty:hidden">
                {formError && (
                  <Alert tone={formError.tone} title={formError.title} live="off">
                    {formError.message}
                  </Alert>
                )}
              </div>

              <button ref={submitRef} type="submit" disabled={busy} className="btn-primary w-full">
                {busy ? <Spinner size="sm" label={null} /> : <LogIn className="w-4 h-4" aria-hidden="true" />}
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
              <div aria-live="polite" className="empty:hidden">
                {slow && (
                  <p className="text-xs text-slate-400 text-center">
                    Waking up the server. This can take up to a minute after a quiet period.
                  </p>
                )}
              </div>
            </form>
          </div>

          <details className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] text-[13px]">
            <summary className="cursor-pointer select-none px-3.5 py-2.5 min-h-10 text-slate-300 hover:text-white">
              Need help signing in?
            </summary>
            <div className="px-3.5 pb-3.5 space-y-2.5 text-slate-400 leading-relaxed">
              <p>
                <span className="font-medium text-slate-200">First time:</span> sign in with the username{' '}
                <code className="text-slate-200">admin</code> and your server’s <code className="text-slate-200">ADMIN_SECRET</code>{' '}
                as the password (or <code className="text-slate-200">ADMIN_USERNAME</code> and{' '}
                <code className="text-slate-200">ADMIN_PASSWORD</code>, if you set them). You’ll choose your own username and
                password next.
              </p>
              <p>
                <span className="font-medium text-slate-200">Forgot your password:</span> set{' '}
                <code className="text-slate-200">ADMIN_RESET_PASSWORD=true</code> on the server and redeploy. Then sign in with the
                first-time details above and choose a new password.
              </p>
            </div>
          </details>
          <p className="mt-4 text-center text-xs text-slate-500 leading-relaxed">
            After 5 wrong attempts, sign-in is paused for 15 minutes.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  )
}
