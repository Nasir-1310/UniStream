'use client'
// components/admin/UserEditModal.tsx
//
// Account details plus an edit form for name, email, phone, note and the
// daily limit. Only changed fields are sent, so a legacy account without a
// phone number can still get a new limit without inventing one.

import { useState, type FormEvent } from 'react'
import { UserCog } from 'lucide-react'
import { Alert, Field, Modal, Spinner, StatusBadge, describedBy, useToast } from '@/components/ui'
import { adminUpdateUser, apiErrorMessage, type AdminUpdateUserRequest, type AdminUser } from '@/lib/api'
import { EMPTY, formatDate, formatLimit, formatNumber, formatPhone, formatRelative } from '@/lib/format'
import { NAME_MAX, validateEmail, validateName, validatePhone } from '@/lib/validation'
import { useAdmin, userLabel } from './AdminContext'
import { DailyLimitField, limitToApi, limitValueFrom, type LimitValue } from './DailyLimitField'
import { DetailList } from './parts'

type FieldName = 'name' | 'email' | 'phone' | 'note' | 'limit'
type Errors = Partial<Record<FieldName, string>>

/** Same limit as the API (300). */
const NOTE_MAX = 300

export function passwordState(user: AdminUser): string {
  if (!user.has_password) return 'Not set yet'
  return user.temp_password ? 'Temporary (sent by admin)' : 'Set by the user'
}

const FORM_ID = 'admin-edit-user-form'

export function UserEditModal({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      dismissible={!busy}
      size="xl"
      title={user ? userLabel(user) : ''}
      description={user ? 'Account details and daily limit' : undefined}
      icon={
        <div className="w-10 h-10 rounded-xl border border-indigo-500/25 bg-indigo-500/10 text-indigo-300 flex items-center justify-center">
          <UserCog className="w-5 h-5" aria-hidden="true" />
        </div>
      }
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" form={FORM_ID} disabled={busy} className="btn-primary">
            {busy && <Spinner size="sm" label={null} />}
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      {user && <EditForm key={user.id} user={user} onClose={onClose} onBusyChange={setBusy} />}
    </Modal>
  )
}

function EditForm({ user, onClose, onBusyChange }: { user: AdminUser; onClose: () => void; onBusyChange: (busy: boolean) => void }) {
  const { handleAuthError, invalidate, overview } = useAdmin()
  const toast = useToast()
  const defaultLimit = overview?.settings.default_daily_limit
  const [name, setName] = useState(user.name ?? '')
  const [email, setEmail] = useState(user.email ?? '')
  const [phone, setPhone] = useState(user.phone ?? '')
  const [note, setNote] = useState(user.note ?? '')
  const [limit, setLimit] = useState<LimitValue>(() => limitValueFrom(user.daily_limit, defaultLimit ?? 4))
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const setBusy = (value: boolean) => {
    setSaving(value)
    onBusyChange(value)
  }
  const validPhone = validatePhone(phone)

  const clearError = (field: FieldName) => setErrors(current => (current[field] ? { ...current, [field]: undefined } : current))

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const next: Errors = {}
    const body: AdminUpdateUserRequest = {}

    // A field the account never had may stay empty (legacy rows); one it had can't be cleared.
    if (name.trim() || user.name) {
      const v = validateName(name)
      if (!v.ok) next.name = v.error
      else if (v.value !== user.name) body.name = v.value
    }
    if (email.trim() || user.email) {
      const v = validateEmail(email)
      if (!v.ok) next.email = v.error
      else if (v.value !== user.email) body.email = v.value
    }
    if (phone.trim() || user.phone) {
      const v = validatePhone(phone)
      if (!v.ok) next.phone = v.error
      else if (v.value !== user.phone) body.phone = v.value
    }
    const cleanNote = note.trim()
    if (cleanNote.length > NOTE_MAX) next.note = `Note must be at most ${NOTE_MAX} characters.`
    else if ((cleanNote || null) !== (user.note || null)) body.note = cleanNote || null

    const limitResult = limitToApi(limit)
    if (!limitResult.ok) next.limit = limitResult.error
    else if (limitResult.value !== user.daily_limit) body.daily_limit = limitResult.value

    setErrors(next)
    if (Object.keys(next).length) return
    if (Object.keys(body).length === 0) {
      onClose()
      return
    }

    setBusy(true)
    try {
      const { user: updated } = await adminUpdateUser(user.id, body)
      invalidate('users')
      toast.success('Changes saved', { description: userLabel(updated) })
      setBusy(false)
      onClose()
    } catch (err) {
      setBusy(false)
      if (handleAuthError(err)) return
      const message = apiErrorMessage(err, 'Could not save the changes.')
      if (/email/i.test(message) && body.email) setErrors({ email: message })
      else if (/phone/i.test(message) && body.phone) setErrors({ phone: message })
      else setFormError(message)
    }
  }

  const usage =
    user.effective_limit === null
      ? `${formatNumber(user.used_today)} today · Unlimited`
      : `${formatNumber(user.used_today)} of ${formatLimit(user.effective_limit)}`

  return (
    <form id={FORM_ID} onSubmit={onSubmit} noValidate>
      <fieldset disabled={saving} className="min-w-0">
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <StatusBadge status={user.status} size="md" />
          {user.identifier && user.identifier !== user.email && (
            <span className="text-xs text-slate-500 break-all">Sign-in ID: {user.identifier}</span>
          )}
        </div>
        <DetailList
          items={[
            ['Requested', formatDate(user.created_at)],
            ['Approved', formatDate(user.approved_at)],
            ['Last sign-in', user.last_login_at ? formatRelative(user.last_login_at) : 'Never'],
            ['Last download', user.last_download_at ? formatRelative(user.last_download_at) : 'Never'],
            ['Today', usage],
            ['All-time downloads', formatNumber(user.total_downloads)],
            ['Password', passwordState(user)],
            ['Password emailed', user.credentials_sent_at ? formatDate(user.credentials_sent_at) : EMPTY],
          ]}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field htmlFor="edit-name" label="Full name" error={errors.name} className="sm:col-span-2">
          <input
            id="edit-name"
            value={name}
            maxLength={NAME_MAX + 20}
            autoComplete="off"
            onChange={e => {
              setName(e.target.value)
              clearError('name')
            }}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy('edit-name', errors.name)}
            className="input-field"
          />
        </Field>
        <Field htmlFor="edit-email" label="Email" error={errors.email}>
          <input
            id="edit-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={e => {
              setEmail(e.target.value)
              clearError('email')
            }}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={describedBy('edit-email', errors.email)}
            className="input-field"
          />
        </Field>
        <Field htmlFor="edit-phone" label="Phone" error={errors.phone} hint={validPhone.ok ? `Saved as ${formatPhone(validPhone.value)}` : 'e.g. 017XXXXXXXX, or +44… outside Bangladesh'}>
          <input
            id="edit-phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            onChange={e => {
              setPhone(e.target.value)
              clearError('phone')
            }}
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={describedBy('edit-phone', errors.phone, 'hint')}
            className="input-field"
          />
        </Field>
        <Field
          htmlFor="edit-note"
          label="Institution / note"
          optional
          error={errors.note}
          hint="Visible only to admins, e.g. department and batch."
          className="sm:col-span-2"
        >
          <textarea
            id="edit-note"
            rows={2}
            value={note}
            maxLength={NOTE_MAX + 50}
            onChange={e => {
              setNote(e.target.value)
              clearError('note')
            }}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={describedBy('edit-note', errors.note, 'hint')}
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
      </div>

      </fieldset>

      {formError && (
        <Alert tone="danger" className="mt-4">
          {formError}
        </Alert>
      )}
    </form>
  )
}
