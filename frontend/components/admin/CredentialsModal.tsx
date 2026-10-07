'use client'
// components/admin/CredentialsModal.tsx
//
// Shown after approving / adding a user or sending a new password when at
// least one password could NOT be emailed. The API returns the plain
// password only in that case and never again, so this dialog is the admin's
// one chance to copy it (or the ready-made message) and share it by hand.

import { useSyncExternalStore } from 'react'
import { KeyRound, MailCheck, MailWarning } from 'lucide-react'
import { Alert, Modal } from '@/components/ui'
import { formatPhone } from '@/lib/format'
import { userLabel, type CredentialsEntry } from './AdminContext'
import { CopyButton } from './parts'

const noopSubscribe = () => () => {}
const readOrigin = () => window.location.origin
const serverOrigin = () => ''

/** Message the admin can paste into WhatsApp / SMS / email. */
export function credentialsMessage(entry: CredentialsEntry, origin: string): string {
  const { user, credentials } = entry
  const lines = [
    `Hi ${user.name?.trim() || 'there'},`,
    '',
    'Your UniStream Saver account is ready.',
    `Sign in: ${origin || 'the UniStream Saver website'}/`,
  ]
  if (user.email) lines.push(`Email: ${user.email}`)
  if (user.phone) lines.push(`Phone: ${user.phone}`)
  lines.push(`Temporary password: ${credentials.password ?? ''}`)
  lines.push('', 'You can sign in with your email or phone number. Please change this password after signing in (Account → Change password).')
  return lines.join('\n')
}

export function CredentialsModal({
  open,
  entries,
  onClose,
}: {
  open: boolean
  entries: CredentialsEntry[]
  onClose: () => void
}) {
  const origin = useSyncExternalStore(noopSubscribe, readOrigin, serverOrigin)
  const manual = entries.filter(entry => !entry.credentials.emailed && entry.credentials.password)
  const emailed = entries.filter(entry => entry.credentials.emailed)
  const single = entries.length === 1

  return (
    <Modal
      open={open}
      onClose={onClose}
      // A password shown here can't be fetched again: only "Done" closes it, so a
      // stray tap on the backdrop doesn't lose it.
      dismissible={manual.length === 0}
      hideCloseButton={manual.length > 0}
      size="lg"
      title={manual.length ? (single ? 'Share this password' : `Share ${manual.length} passwords`) : 'Passwords emailed'}
      description={
        manual.length
          ? 'The email could not be sent, so copy the temporary password and send it yourself. It is shown only once — if you lose it, send a new password.'
          : undefined
      }
      icon={
        <div
          className={`w-10 h-10 rounded-xl border flex items-center justify-center ${
            manual.length ? 'bg-amber-500/10 border-amber-500/25 text-amber-300' : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
          }`}
        >
          <KeyRound className="w-5 h-5" aria-hidden="true" />
        </div>
      }
      footer={
        <button type="button" onClick={onClose} className="btn-primary" data-autofocus={manual.length ? undefined : true}>
          Done
        </button>
      }
    >
      <div className="space-y-3">
        {manual.map(entry => (
          <div key={entry.user.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{userLabel(entry.user)}</p>
                <p className="mt-0.5 text-xs text-slate-400 break-all">
                  {[entry.user.email, entry.user.phone ? formatPhone(entry.user.phone) : null].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
            {entry.credentials.email_error && (
              <p className="mt-2.5 flex items-start gap-2 text-xs text-amber-200/90">
                <MailWarning className="w-3.5 h-3.5 mt-px flex-shrink-0 text-amber-400" aria-hidden="true" />
                <span>Email not sent: {entry.credentials.email_error}</span>
              </p>
            )}
            <div className="mt-3 flex flex-col gap-2 min-[440px]:flex-row min-[440px]:items-stretch">
              <output
                className="flex-1 min-w-0 rounded-lg border border-indigo-500/30 bg-[#0d0f1a] px-3.5 py-2.5 font-mono text-base sm:text-lg
                           tracking-wider text-white select-all break-all"
                aria-label={`Temporary password for ${userLabel(entry.user)}`}
              >
                {entry.credentials.password}
              </output>
              <CopyButton text={entry.credentials.password ?? ''} label="Copy password" className="btn-secondary btn-sm" />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <CopyButton
                text={credentialsMessage(entry, origin)}
                label="Copy message for WhatsApp / SMS"
                copiedLabel="Message copied"
                className="btn-ghost btn-sm px-2 text-indigo-300 hover:text-indigo-200"
              />
            </div>
          </div>
        ))}

        {emailed.length > 0 && (
          <Alert tone="success" title={emailed.length === 1 ? 'Password emailed' : `${emailed.length} passwords emailed`} live="off">
            <ul className="mt-1 space-y-1">
              {emailed.map(entry => (
                <li key={entry.user.id} className="flex items-start gap-2 break-all">
                  <MailCheck className="w-3.5 h-3.5 mt-1 flex-shrink-0 text-emerald-400" aria-hidden="true" />
                  <span>
                    {userLabel(entry.user)}
                    {entry.user.email && entry.user.name ? <span className="text-slate-400"> — {entry.user.email}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </Alert>
        )}

        {manual.length > 0 && (
          <p className="text-xs text-slate-500">
            Set up email under <span className="text-slate-300">Settings → Email delivery</span> so future passwords are sent automatically.
          </p>
        )}
      </div>
    </Modal>
  )
}
