'use client'
// components/admin/SettingsSection.tsx
//
// Default daily limit, email delivery (status + test message), security and
// app configuration. Everything except the limit is read-only here: those
// values are environment variables on the server, and the cards say which.

import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { Clock, Gauge, Globe, LogOut, Mail, Send, ShieldCheck } from 'lucide-react'
import { Alert, Badge, Field, Spinner, describedBy, useConfirm, useToast } from '@/components/ui'
import { adminGetSettings, adminSendTestEmail, adminUpdateSettings, apiErrorMessage, type Settings } from '@/lib/api'
import { formatLimit, formatTime } from '@/lib/format'
import { DAILY_LIMIT_MAX, validateDailyLimit, validateEmail } from '@/lib/validation'
import { useAdmin } from './AdminContext'
import { useAdminQuery, useClock } from './hooks'
import { Card, CheckRow, QueryError, SectionHeader, SkeletonRows } from './parts'

const LIMIT_PRESETS = [2, 4, 6, 10]

const noopSubscribe = () => () => {}
const readOrigin = () => window.location.origin
const serverOrigin = () => ''

export function SettingsSection() {
  const { revisions } = useAdmin()
  const query = useAdminQuery(`settings|${revisions.settings}|${revisions.system}`, adminGetSettings)
  const settings = query.data

  return (
    <section aria-labelledby="admin-h-settings">
      <SectionHeader id="settings" title="Settings" description="Download limits, email delivery and security." />

      {query.error && (
        <div className="mb-4">
          <QueryError message={query.error} onRetry={query.reload} title="Could not load the settings" />
        </div>
      )}

      {!settings ? (
        !query.error && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SkeletonRows count={1} className="h-64" />
            <SkeletonRows count={1} className="h-64" />
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 items-start">
          <LimitCard key={settings.default_daily_limit} settings={settings} onSaved={next => query.mutate(() => next)} />
          <EmailCard settings={settings} />
          <SecurityCard settings={settings} />
          <AppCard settings={settings} />
        </div>
      )}
    </section>
  )
}

// ── Default daily limit ───────────────────────────────────────────────────────

function LimitCard({ settings, onSaved }: { settings: Settings; onSaved: (settings: Settings) => void }) {
  const { secret, invalidate, handleAuthError } = useAdmin()
  const toast = useToast()
  const confirm = useConfirm()
  const [value, setValue] = useState(String(settings.default_daily_limit))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const parsed = validateDailyLimit(value)
  const changed = parsed.ok && parsed.value !== settings.default_daily_limit

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    if (!changed) return
    if (parsed.value === 0) {
      const ok = await confirm({
        title: 'Pause downloads for most users?',
        message: 'Everyone on the default limit will be unable to download until you raise it again. Custom and unlimited users are not affected.',
        confirmLabel: 'Set limit to 0',
        tone: 'warning',
      })
      if (!ok) return
    }
    setSaving(true)
    try {
      const next = await adminUpdateSettings(secret, { default_daily_limit: parsed.value })
      toast.success(`Default limit set to ${formatLimit(next.default_daily_limit)}`, {
        description: 'Applies right away to everyone on the default limit.',
      })
      onSaved(next)
      invalidate('settings')
    } catch (err) {
      if (!handleAuthError(err)) setError(apiErrorMessage(err, 'Could not save the limit.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Daily download limit" description="How many videos each user can download per day" icon={Gauge}>
      <form onSubmit={onSubmit} noValidate>
        <Field
          htmlFor="settings-limit"
          label="Default limit per user"
          error={error}
          hint={`Whole number from 0 to ${DAILY_LIMIT_MAX.toLocaleString('en-US')}.`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="settings-limit"
              type="number"
              inputMode="numeric"
              min={0}
              max={DAILY_LIMIT_MAX}
              step={1}
              value={value}
              disabled={saving}
              onChange={e => {
                setValue(e.target.value)
                setError(null)
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy('settings-limit', error, 'hint')}
              className="input-field w-28 tabular-nums"
            />
            <span className="text-[13px] text-slate-400">downloads per day</span>
          </div>
        </Field>
        <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick values">
          {LIMIT_PRESETS.map(preset => (
            <button
              key={preset}
              type="button"
              disabled={saving}
              aria-pressed={value === String(preset)}
              onClick={() => {
                setValue(String(preset))
                setError(null)
              }}
              className={`h-10 min-w-12 rounded-lg border px-3 text-[13px] font-medium tabular-nums transition-colors ${
                value === String(preset)
                  ? 'border-indigo-500/40 bg-indigo-500/15 text-white'
                  : 'border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>

        <ul className="mt-4 space-y-1.5 text-xs text-slate-400 list-disc pl-4">
          <li>Applies to every user set to “Default”. Users with a custom limit or Unlimited keep theirs (edit them under Users).</li>
          <li>Counts reset at midnight, {settings.timezone.replace(/_/g, ' ')} time.</li>
          <li>Only finished downloads count — analysing a link or a failed download doesn’t.</li>
        </ul>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving || !changed} className="btn-primary btn-sm">
            {saving && <Spinner size="sm" label={null} />}
            {saving ? 'Saving…' : 'Save limit'}
          </button>
          {!changed && !error && (
            <span className="text-xs text-slate-500">Current: {formatLimit(settings.default_daily_limit)}</span>
          )}
        </div>
      </form>
    </Card>
  )
}

// ── Email ─────────────────────────────────────────────────────────────────────

const PROVIDER_NAMES: Record<string, string> = { brevo: 'Brevo', resend: 'Resend', smtp: 'SMTP' }

function EmailCard({ settings }: { settings: Settings }) {
  const { secret, handleAuthError } = useAdmin()
  const toast = useToast()
  const { email } = settings
  const [to, setTo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [sending, setSending] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setResult(null)
    const address = validateEmail(to)
    if (!address.ok) {
      setError(address.error)
      return
    }
    setSending(true)
    try {
      await adminSendTestEmail(secret, address.value)
      setResult({ ok: true, message: `Sent to ${address.value}. Check the inbox and the spam folder.` })
      toast.success('Test email sent')
    } catch (err) {
      if (!handleAuthError(err)) setResult({ ok: false, message: apiErrorMessage(err, 'The test email could not be sent.') })
    } finally {
      setSending(false)
    }
  }

  return (
    <Card
      title="Email delivery"
      description="Approval passwords and password-reset links"
      icon={Mail}
      actions={
        <Badge tone={email.configured ? 'success' : 'warning'} dot>
          {email.configured ? 'Working' : 'Not set up'}
        </Badge>
      }
    >
      <ul className="divide-y divide-white/[0.05] -mt-2">
        <CheckRow
          ok={email.configured}
          warn
          label={email.provider ? `Provider: ${PROVIDER_NAMES[email.provider] ?? email.provider}` : 'No email provider configured'}
          detail={email.issue ?? undefined}
        />
        <CheckRow
          ok={Boolean(email.from_email)}
          warn
          label={email.from_email ? `Sender: ${email.from_name} <${email.from_email}>` : 'Sender address (EMAIL_FROM) is not set'}
        />
      </ul>

      <form onSubmit={onSubmit} noValidate className="mt-4">
        <Field htmlFor="settings-test-email" label="Send a test email" error={error}>
          <div className="flex flex-col gap-2 min-[420px]:flex-row">
            <input
              id="settings-test-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              value={to}
              disabled={sending}
              onChange={e => {
                setTo(e.target.value)
                setError(null)
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy('settings-test-email', error)}
              className="input-field flex-1"
            />
            <button type="submit" disabled={sending || !email.configured} className="btn-secondary btn-sm">
              {sending ? <Spinner size="sm" label={null} /> : <Send className="w-4 h-4" aria-hidden="true" />}
              {sending ? 'Sending…' : 'Send test'}
            </button>
          </div>
        </Field>
        {result && (
          <Alert tone={result.ok ? 'success' : 'danger'} className="mt-3" title={result.ok ? 'Test email sent' : 'Sending failed'}>
            {result.message}
          </Alert>
        )}
      </form>

      <details className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] text-[13px]" open={!email.configured}>
        <summary className="cursor-pointer select-none px-3.5 py-2.5 text-slate-300 hover:text-white">How to set up email</summary>
        <div className="px-3.5 pb-3.5 text-slate-400 space-y-2">
          <p>
            Recommended: a free <span className="text-slate-200">Brevo</span> account (300 emails/day). Verify a single sender
            address, create an API key, then set these environment variables on the server and redeploy:
          </p>
          <pre className="overflow-x-auto rounded-lg border border-white/[0.06] bg-[#0b0d17] p-3 text-[11px] leading-relaxed text-slate-300">
{`EMAIL_PROVIDER=brevo
BREVO_API_KEY=xkeysib-…
EMAIL_FROM=you@yourdomain.com
EMAIL_FROM_NAME=UniStream Saver`}
          </pre>
          <p>
            Resend (<code className="text-slate-300">RESEND_API_KEY</code>) and SMTP (<code className="text-slate-300">SMTP_HOST</code>,{' '}
            <code className="text-slate-300">SMTP_USER</code>, <code className="text-slate-300">SMTP_PASSWORD</code>) work too, but
            free Render instances may block SMTP ports.
          </p>
        </div>
      </details>
    </Card>
  )
}

// ── Security ──────────────────────────────────────────────────────────────────

function SecurityCard({ settings }: { settings: Settings }) {
  const { signOut, navigate } = useAdmin()
  return (
    <Card title="Security" description="Sessions, passwords and admin access" icon={ShieldCheck}>
      <ul className="divide-y divide-white/[0.05] -mt-2">
        <CheckRow
          ok={settings.auth_secret_configured}
          warn
          label={settings.auth_secret_configured ? 'AUTH_SECRET is set — user sessions are signed securely' : 'AUTH_SECRET is not set'}
          detail={
            settings.auth_secret_configured
              ? 'Sessions last 30 days and end immediately when a password changes or the user is blocked.'
              : 'Set AUTH_SECRET to a random value of at least 32 characters on the server, then redeploy.'
          }
        />
        <CheckRow
          ok={settings.schema.ready}
          label={settings.schema.ready ? 'Database schema is up to date' : 'Database upgrade required'}
          detail={
            settings.schema.ready ? undefined : (
              <button type="button" onClick={() => navigate('system')} className="text-indigo-300 hover:text-indigo-200">
                Open System to run the migration →
              </button>
            )
          }
        />
        <CheckRow
          ok
          label="Passwords are stored as salted scrypt hashes"
          detail="Nobody, including admins, can read a user’s password. Use “Send new password” if someone is locked out."
        />
        <CheckRow
          ok
          label="Admin secret"
          detail="Kept only in this browser tab. Wrong attempts are limited to 10 per 15 minutes. Change ADMIN_SECRET on the server to revoke access."
        />
      </ul>
      <button type="button" onClick={() => signOut()} className="btn-outline mt-4">
        <LogOut className="w-4 h-4" aria-hidden="true" />
        Sign out of admin
      </button>
    </Card>
  )
}

// ── App configuration ─────────────────────────────────────────────────────────

function AppCard({ settings }: { settings: Settings }) {
  const origin = useSyncExternalStore(noopSubscribe, readOrigin, serverOrigin)
  const now = useClock()
  const frontend = settings.frontend_url.replace(/\/+$/, '')
  const pointsToLocalhost = /localhost|127\.0\.0\.1/.test(frontend)
  const mismatch = Boolean(origin) && frontend !== origin && pointsToLocalhost && !/localhost|127\.0\.0\.1/.test(origin)
  const zone = settings.timezone

  return (
    <Card title="App" description="Values set by environment variables on the server" icon={Globe}>
      <dl className="space-y-3 text-[13px]">
        <div>
          <dt className="text-xs text-slate-500">Website address in emails (FRONTEND_URL)</dt>
          <dd className="mt-0.5 text-slate-200 break-all">{frontend || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Day boundary for limits (APP_TIMEZONE)</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 text-slate-200">
            <Clock className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            {zone.replace(/_/g, ' ')} · now {now ? formatTime(now, zone) : '—'}
          </dd>
        </div>
      </dl>
      {mismatch && (
        <Alert tone="warning" className="mt-4" title="Email links point to localhost">
          Set <code className="text-slate-100">FRONTEND_URL={origin}</code> on the server so sign-in and password-reset links in
          emails open this site.
        </Alert>
      )}
    </Card>
  )
}
