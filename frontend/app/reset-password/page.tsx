'use client'
// frontend/app/reset-password/page.tsx
//
// Landing spot for the emailed reset link (/reset-password?token=…). Setting
// the new password also signs the user in: the API returns a fresh session,
// which resetPassword() stores, so we can go straight to the downloader.

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, CheckCircle2, LinkIcon, LockKeyhole } from 'lucide-react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { Alert, PageLoader, PasswordInput, Spinner, useToast } from '@/components/ui'
import { apiErrorMessage, apiErrorStatus, resetPassword } from '@/lib/api'
import { PASSWORD_MIN, validatePassword, validatePasswordConfirm } from '@/lib/validation'

/**
 * Set `.current` to an element in a submit handler; it gets focus once `busy`
 * is false again (disabled inputs can't take focus while the request runs).
 */
function useFocusWhenIdle(busy: boolean) {
  const target = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (busy || !target.current) return
    target.current.focus()
    target.current = null
  }, [busy])
  return target
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-svh flex flex-col bg-[#0d0f1a]">
      <Navbar />
      <main id="main" className="relative z-10 flex-1 px-4 sm:px-8 py-8 sm:py-16">
        <div className="w-full max-w-md mx-auto">
          <Link
            href="/#auth"
            className="inline-flex items-center gap-1.5 min-h-10 mb-3 text-[13px] text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Back to sign in
          </Link>
          <div className="portal-card p-5 sm:p-8">
            <Suspense fallback={<PageLoader fullScreen={false} label="Checking your link…" />}>
              <ResetPasswordForm />
            </Suspense>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}

function InvalidLink({ reason }: { reason?: string }) {
  return (
    <div className="relative">
      <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center mb-4">
        <LinkIcon className="w-6 h-6 text-amber-300" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold text-white">This link doesn&apos;t work</h1>
      <p role="alert" className="mt-2 text-sm leading-relaxed text-slate-400">
        {reason || 'This reset link is invalid or has expired. Request a new one.'}
      </p>
      <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
        Reset links work for 60 minutes and only once. If you requested several, use the newest email.
      </p>
      <div className="mt-6 grid gap-2.5">
        <Link href="/forgot-password" className="btn-primary w-full">
          Request a new link
        </Link>
        <Link href="/#auth" className="btn-ghost w-full">
          Back to sign in
        </Link>
      </div>
    </div>
  )
}

function ResetPasswordForm() {
  const router = useRouter()
  const toast = useToast()
  const params = useSearchParams()
  const token = (params.get('token') ?? '').trim()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const focusAfterRef = useFocusWhenIdle(submitting)

  if (!token) return <InvalidLink reason="This reset link is incomplete. Open the link from your email again, or request a new one." />
  if (linkError) return <InvalidLink reason={linkError} />

  const passwordCheck = validatePassword(password)
  const confirmCheck = validatePasswordConfirm(password, confirm)
  const passwordError = submitted && !passwordCheck.ok ? passwordCheck.error : null
  const confirmError = submitted && passwordCheck.ok && !confirmCheck.ok ? confirmCheck.error : null

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    setError(null)
    if (!passwordCheck.ok) {
      passwordRef.current?.focus()
      return
    }
    if (!confirmCheck.ok) {
      confirmRef.current?.focus()
      return
    }
    setSubmitting(true)
    try {
      const { user } = await resetPassword(token, password)
      setDone(true)
      toast.success('Password updated', {
        description: user.name ? `You're signed in, ${user.name.split(/\s+/)[0]}.` : "You're signed in.",
      })
      router.replace('/download')
    } catch (err) {
      const status = apiErrorStatus(err)
      const message = apiErrorMessage(err, 'We couldn’t update your password. Please try again.')
      // 400 with "link" in it = bad/expired/used token; other 400s are password rules.
      if (status === 400 && /link|token/i.test(message)) {
        setLinkError(message)
      } else {
        setError(message)
        focusAfterRef.current = passwordRef.current
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center text-center py-6 gap-3" role="status">
        <CheckCircle2 className="w-10 h-10 text-emerald-400" aria-hidden="true" />
        <h1 className="text-xl font-bold text-white">Password updated</h1>
        <p className="text-sm text-slate-400">You&apos;re signed in. Taking you to your downloads…</p>
        <Link href="/download" className="mt-2 btn-primary">
          Continue
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="relative" aria-describedby="reset-intro">
      <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center mb-4">
        <LockKeyhole className="w-6 h-6 text-indigo-300" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold text-white">Set a new password</h1>
      <p id="reset-intro" className="mt-2 mb-6 text-sm leading-relaxed text-slate-400">
        Choose a password you don&apos;t use anywhere else: at least {PASSWORD_MIN} characters with a letter and a number.
        You&apos;ll be signed in right after.
      </p>

      {error && (
        <Alert tone="danger" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div className="space-y-4">
        <PasswordInput
          ref={passwordRef}
          id="reset-password"
          name="new-password"
          label="New password"
          showStrength
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={e => {
            setPassword(e.target.value)
            setError(null)
          }}
          disabled={submitting}
          error={passwordError}
        />
        <PasswordInput
          ref={confirmRef}
          id="reset-confirm"
          name="confirm-password"
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={e => {
            setConfirm(e.target.value)
            setError(null)
          }}
          disabled={submitting}
          error={confirmError}
        />
      </div>

      <button type="submit" className="btn-primary w-full mt-6" disabled={submitting}>
        {submitting ? (
          <>
            <Spinner size="sm" label={null} /> Saving…
          </>
        ) : (
          'Save password and sign in'
        )}
      </button>
      <p className="mt-4 text-center text-xs text-slate-500">
        Changing your password signs you out on every other device.
      </p>
    </form>
  )
}
