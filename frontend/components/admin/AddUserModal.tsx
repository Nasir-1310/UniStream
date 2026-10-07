'use client'
// components/admin/AddUserModal.tsx
//
// Add an account directly (e.g. a lecturer asked by phone). Approved users
// get a generated temporary password by email; if email isn't configured the
// password comes back to the admin to share by hand.

import { useState, type FormEvent } from 'react'
import { UserPlus } from 'lucide-react'
import { Alert, Field, Modal, Spinner, describedBy } from '@/components/ui'
import { adminCreateUser, apiErrorMessage } from '@/lib/api'
import { formatPhone } from '@/lib/format'
import { NAME_MAX, validateEmail, validateName, validatePhone } from '@/lib/validation'
import { useAdmin, userLabel } from './AdminContext'
import { DailyLimitField, limitToApi, type LimitValue } from './DailyLimitField'

type FieldName = 'name' | 'email' | 'phone' | 'note' | 'limit'
type Errors = Partial<Record<FieldName, string>>

const FORM_ID = 'admin-add-user-form'
/** Same limit as the API (300). */
const NOTE_MAX = 300

export function AddUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!busy}
      size="lg"
      title="Add a user"
      description="Create an account directly, without an access request."
      icon={
        <div className="w-10 h-10 rounded-xl border border-indigo-500/25 bg-indigo-500/10 text-indigo-300 flex items-center justify-center">
          <UserPlus className="w-5 h-5" aria-hidden="true" />
        </div>
      }
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" form={FORM_ID} disabled={busy} className="btn-primary">
            {busy && <Spinner size="sm" label={null} />}
            {busy ? 'Adding…' : 'Add user'}
          </button>
        </>
      }
    >
      {/* Mounted only while open, so every opening starts with an empty form. */}
      <AddUserForm onDone={onClose} onBusyChange={setBusy} busy={busy} />
    </Modal>
  )
}

function AddUserForm({ onDone, onBusyChange, busy }: { onDone: () => void; onBusyChange: (busy: boolean) => void; busy: boolean }) {
  const { handleAuthError, invalidate, overview, presentCredentials } = useAdmin()
  const defaultLimit = overview?.settings.default_daily_limit
  const emailReady = overview?.system.email.configured ?? true
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [limit, setLimit] = useState<LimitValue>({ mode: 'default', custom: String(defaultLimit ?? 4) })
  const [status, setStatus] = useState<'approved' | 'pending'>('approved')
  const [sendCredentials, setSendCredentials] = useState(true)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const validPhone = validatePhone(phone)

  const clearError = (field: FieldName) => setErrors(current => (current[field] ? { ...current, [field]: undefined } : current))

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const n = validateName(name)
    const e = validateEmail(email)
    const p = validatePhone(phone)
    const l = limitToApi(limit)
    const cleanNote = note.trim()
    const next: Errors = {
      name: n.ok ? undefined : n.error,
      email: e.ok ? undefined : e.error,
      phone: p.ok ? undefined : p.error,
      note: cleanNote.length > NOTE_MAX ? `Note must be at most ${NOTE_MAX} characters.` : undefined,
      limit: l.ok ? undefined : l.error,
    }
    setErrors(next)
    if (!n.ok || !e.ok || !p.ok || !l.ok || next.note) {
      const first = (['name', 'email', 'phone', 'note'] as const).find(key => next[key])
      if (first) document.getElementById(`add-${first}`)?.focus()
      return
    }

    onBusyChange(true)
    try {
      const result = await adminCreateUser({
        name: n.value,
        email: e.value,
        phone: p.value,
        note: cleanNote || null,
        daily_limit: l.value,
        status,
        send_credentials: status === 'approved' && sendCredentials,
      })
      invalidate('users')
      onBusyChange(false)
      onDone()
      if (result.credentials) {
        presentCredentials([{ user: result.user, credentials: result.credentials }], `${userLabel(result.user)} added`)
      } else {
        presentCredentials([], `${userLabel(result.user)} added`)
      }
    } catch (err) {
      onBusyChange(false)
      if (handleAuthError(err)) return
      const message = apiErrorMessage(err, 'Could not add the user.')
      if (/email/i.test(message) && !/send|sent/i.test(message)) setErrors({ email: message })
      else if (/phone/i.test(message)) setErrors({ phone: message })
      else setFormError(message)
    }
  }

  return (
    <form id={FORM_ID} onSubmit={onSubmit} noValidate>
      <fieldset disabled={busy} className="min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field htmlFor="add-name" label="Full name" error={errors.name} className="sm:col-span-2">
          <input
            id="add-name"
            data-autofocus
            value={name}
            maxLength={NAME_MAX + 20}
            autoComplete="off"
            onChange={ev => {
              setName(ev.target.value)
              clearError('name')
            }}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy('add-name', errors.name)}
            className="input-field"
          />
        </Field>
        <Field htmlFor="add-email" label="Email" error={errors.email}>
          <input
            id="add-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name@gmail.com"
            value={email}
            onChange={ev => {
              setEmail(ev.target.value)
              clearError('email')
            }}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={describedBy('add-email', errors.email)}
            className="input-field"
          />
        </Field>
        <Field
          htmlFor="add-phone"
          label="Phone"
          error={errors.phone}
          hint={validPhone.ok ? `Saved as ${formatPhone(validPhone.value)}` : 'e.g. 017XXXXXXXX, or +44… outside Bangladesh'}
        >
          <input
            id="add-phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="017XXXXXXXX"
            value={phone}
            onChange={ev => {
              setPhone(ev.target.value)
              clearError('phone')
            }}
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={describedBy('add-phone', errors.phone, 'hint')}
            className="input-field"
          />
        </Field>
        <Field htmlFor="add-note" label="Institution / note" optional error={errors.note} className="sm:col-span-2">
          <input
            id="add-note"
            value={note}
            maxLength={NOTE_MAX + 50}
            placeholder="e.g. CSE, batch 24"
            onChange={ev => {
              setNote(ev.target.value)
              clearError('note')
            }}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={describedBy('add-note', errors.note)}
            className="input-field"
          />
        </Field>

        <div className="sm:col-span-2">
          <DailyLimitField
            value={limit}
            onChange={value => {
              setLimit(value)
              clearError('limit')
            }}
            defaultLimit={defaultLimit}
            error={errors.limit}
          />
        </div>

        <fieldset className="sm:col-span-2 min-w-0">
          <legend className="field-label">Access</legend>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
            {(
              [
                ['approved', 'Approved', 'Can sign in right away.'],
                ['pending', 'Pending', 'Approve later from Users.'],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors has-[:focus-visible]:outline
                  has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-indigo-500/70 ${
                    status === value ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-white/10 hover:bg-white/[0.03]'
                  }`}
              >
                <input
                  type="radio"
                  name="add-status"
                  value={value}
                  checked={status === value}
                  onChange={() => setStatus(value)}
                  className="mt-1 accent-indigo-500"
                />
                <span>
                  <span className="block text-[13px] font-semibold text-white">{label}</span>
                  <span className="block text-xs text-slate-400">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {status === 'approved' && (
          <div className="sm:col-span-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 px-3.5 py-3 hover:bg-white/[0.03]">
              <input
                type="checkbox"
                checked={sendCredentials}
                onChange={ev => setSendCredentials(ev.target.checked)}
                className="mt-1 w-4 h-4 accent-indigo-500"
              />
              <span>
                <span className="block text-[13px] font-semibold text-white">Send a password by email</span>
                <span className="block text-xs text-slate-400">
                  {emailReady
                    ? 'They get their sign-in details and a temporary password to change after signing in.'
                    : 'Email isn’t set up yet, so the password is shown to you to share.'}
                </span>
              </span>
            </label>
            {!sendCredentials && (
              <p className="mt-2 text-xs text-slate-500">
                Without a password they can’t sign in until you send one or they use “Forgot password?”.
              </p>
            )}
          </div>
        )}
      </fieldset>

      {formError && (
        <Alert tone="danger" className="mt-4">
          {formError}
        </Alert>
      )}
    </form>
  )
}
