'use client'
// components/admin/AdminCredentialsForm.tsx
//
// Change the admin username and password (POST /admin/auth/change-credentials).
// Used twice: the forced "Set your admin username and password" step after
// signing in with the setup password, and Settings → Admin account.
//
// The API always sets a new password (it must differ from the current one),
// so a new username is saved together with a new password. On success lib/api
// stores the fresh session; every other admin session ends.

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Circle, Save } from 'lucide-react'
import { Alert, Field, PasswordInput, Spinner, describedBy } from '@/components/ui'
import { adminChangeCredentials, apiErrorMessage, apiErrorStatus, type AdminAuthResponse, type AdminSession } from '@/lib/api'
import {
  ADMIN_LOGIN_PASSWORD_MAX,
  ADMIN_PASSWORD_MAX,
  ADMIN_PASSWORD_MIN,
  ADMIN_USERNAME_MAX,
  ADMIN_USERNAME_MIN,
  adminPasswordRules,
  validateAdminPassword,
  validateAdminUsername,
} from './adminValidation'
import { isAdminSessionEnded } from './hooks'

type FieldName = 'username' | 'current' | 'next' | 'confirm'
type Errors = Partial<Record<FieldName, string>>

interface FormError {
  tone: 'danger' | 'warning'
  title?: string
  message: string
}

export interface AdminCredentialsFormProps {
  /** "setup": the forced first step; "settings": the Admin account card. */
  mode: 'setup' | 'settings'
  session: AdminSession
  /** Prefill for the current password (the setup password just used to sign in). */
  initialCurrentPassword?: string
  /** After the new details are saved (the new session is already stored). */
  onSaved: (auth: AdminAuthResponse) => void
  /** The server can't save yet because the database upgrade hasn't been run. */
  onSchemaRequired?: () => void
}

export function AdminCredentialsForm({
  mode,
  session,
  initialCurrentPassword = '',
  onSaved,
  onSchemaRequired,
}: AdminCredentialsFormProps) {
  const id = (name: string) => `admin-${mode}-${name}`
  const [username, setUsername] = useState(session.username)
  // null until edited: shows the prefill, which can arrive just after mount.
  const [current, setCurrent] = useState<string | null>(null)
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<FormError | null>(null)
  const [busy, setBusy] = useState(false)
  const submitRef = useRef<HTMLButtonElement>(null)
  // Where focus goes once a failed request re-enables the form (the browser
  // drops focus from disabled controls while the request runs).
  const focusAfter = useRef<FieldName | 'submit' | null>(null)
  const currentValue = current ?? initialCurrentPassword
  const rules = adminPasswordRules(next)

  useEffect(() => {
    const target = focusAfter.current
    if (busy || !target) return
    focusAfter.current = null
    if (target === 'submit') {
      submitRef.current?.focus()
      return
    }
    const input = document.getElementById(`admin-${mode}-${target}`)
    input?.focus()
    if (input instanceof HTMLInputElement) input.select()
  }, [busy, mode])

  const clear = (field: FieldName) => {
    setErrors(existing => (existing[field] ? { ...existing, [field]: undefined } : existing))
    setFormError(null)
  }

  const focus = (field: FieldName) => document.getElementById(id(field))?.focus()

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setFormError(null)
    const user = validateAdminUsername(username)
    const pw = validateAdminPassword(next)
    const found: Errors = {
      username: user.ok ? undefined : user.error,
      current: currentValue ? undefined : 'Please enter your current password.',
      next: !pw.ok
        ? pw.error
        : next === currentValue
        ? 'Your new password must be different from your current password.'
        : undefined,
      confirm: !confirm ? 'Please confirm your new password.' : confirm !== next ? 'Passwords don’t match.' : undefined,
    }
    setErrors(found)
    const firstInvalid = (['username', 'current', 'next', 'confirm'] as const).find(field => found[field])
    if (firstInvalid) {
      focus(firstInvalid)
      return
    }

    setBusy(true)
    try {
      const auth = await adminChangeCredentials({
        current_password: currentValue,
        new_password: next,
        new_username: user.value !== session.username ? user.value : null,
      })
      setBusy(false)
      setCurrent('')
      setNext('')
      setConfirm('')
      setErrors({})
      onSaved(auth)
    } catch (err) {
      if (isAdminSessionEnded(err)) {
        setBusy(false)
        return
      }
      const status = apiErrorStatus(err)
      const message = apiErrorMessage(err, 'Your new details could not be saved. Please try again.')
      focusAfter.current = 'submit'
      // The API's sentences name the field they are about.
      if ((status === 400 || status === 422) && /new password|admin password|ADMIN_SECRET/i.test(message)) {
        setErrors({ next: message })
        focusAfter.current = 'next'
      } else if ((status === 400 || status === 422) && /current password/i.test(message)) {
        setErrors({ current: message })
        focusAfter.current = 'current'
      } else if (status === 422 && /username/i.test(message)) {
        setErrors({ username: message })
        focusAfter.current = 'username'
      } else if (status === 503 && /database upgrade/i.test(message)) {
        setFormError({
          tone: 'warning',
          title: 'Database upgrade needed first',
          message:
            mode === 'setup'
              ? 'Your new password is saved in the database, which needs its one-time upgrade first. Run the upgrade above, press “Check again”, then save.'
              : message,
        })
        onSchemaRequired?.()
      } else if (status === 429) {
        setFormError({ tone: 'warning', title: 'Too many attempts', message })
      } else {
        setFormError({ tone: 'danger', message })
      }
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <Field
          htmlFor={id('username')}
          label="Username"
          error={errors.username}
          hint={`${ADMIN_USERNAME_MIN}–${ADMIN_USERNAME_MAX} characters: letters, numbers, dots, dashes or underscores.`}
        >
          <input
            id={id('username')}
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={ADMIN_USERNAME_MAX + 8}
            value={username}
            onChange={event => {
              setUsername(event.target.value)
              clear('username')
            }}
            onBlur={() => setUsername(value => value.trim().toLowerCase())}
            aria-invalid={errors.username ? true : undefined}
            aria-describedby={describedBy(id('username'), errors.username, 'hint')}
            className={`input-field ${errors.username ? 'input-error' : ''}`}
          />
        </Field>

        <PasswordInput
          id={id('current')}
          name="current-password"
          label="Current password"
          autoComplete="current-password"
          maxLength={ADMIN_LOGIN_PASSWORD_MAX}
          value={currentValue}
          onChange={event => {
            setCurrent(event.target.value)
            clear('current')
          }}
          error={errors.current}
          hint={mode === 'setup' ? 'The password you just signed in with.' : undefined}
        />

        <div>
          <PasswordInput
            id={id('next')}
            name="new-password"
            label="New password"
            autoComplete="new-password"
            showStrength
            strengthMinLength={ADMIN_PASSWORD_MIN}
            maxLength={ADMIN_PASSWORD_MAX + 8}
            value={next}
            onChange={event => {
              setNext(event.target.value)
              clear('next')
            }}
            error={errors.next}
          />
          <ul className="mt-2 space-y-1 text-xs" aria-label="Password requirements">
            <Rule met={rules.length}>{`At least ${ADMIN_PASSWORD_MIN} characters`}</Rule>
            <Rule met={rules.letterAndNumber}>At least one letter and one number</Rule>
          </ul>
        </div>

        <PasswordInput
          id={id('confirm')}
          name="confirm-password"
          label="Confirm new password"
          autoComplete="new-password"
          maxLength={ADMIN_PASSWORD_MAX + 8}
          value={confirm}
          onChange={event => {
            setConfirm(event.target.value)
            clear('confirm')
          }}
          error={errors.confirm}
        />
      </fieldset>

      <div aria-live="assertive" className="empty:hidden">
        {formError && (
          <Alert tone={formError.tone} title={formError.title} live="off" className="mt-4">
            {formError.message}
          </Alert>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-center">
        <button ref={submitRef} type="submit" disabled={busy} className={`btn-primary ${mode === 'setup' ? 'w-full min-[420px]:w-auto' : 'btn-sm'}`}>
          {busy ? <Spinner size="sm" label={null} /> : <Save className="w-4 h-4" aria-hidden="true" />}
          {busy ? 'Saving…' : mode === 'setup' ? 'Save and continue' : 'Save changes'}
        </button>
        <p className="text-xs text-slate-500">You’ll stay signed in here. Other devices are signed out.</p>
      </div>
    </form>
  )
}

function Rule({ met, children }: { met: boolean; children: string }) {
  return (
    <li className={`flex items-center gap-2 ${met ? 'text-emerald-300' : 'text-slate-500'}`}>
      {met ? <Check className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" /> : <Circle className="w-3 h-3 mx-px flex-shrink-0" aria-hidden="true" />}
      <span>
        {children}
        <span className="sr-only">{met ? ' (done)' : ' (not yet)'}</span>
      </span>
    </li>
  )
}
