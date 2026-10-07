// components/admin/adminValidation.ts
//
// Client mirrors of the backend's admin account rules (security.py
// validate_admin_username / validate_admin_password), with the same messages,
// so the forms can point at the right field before a round trip. The server
// still checks everything.

import type { Validation } from '@/lib/validation'

export const ADMIN_USERNAME_MIN = 3
export const ADMIN_USERNAME_MAX = 32
/** Stricter than user passwords (8): this account controls everyone's. */
export const ADMIN_PASSWORD_MIN = 10
export const ADMIN_PASSWORD_MAX = 128
/** The sign-in form accepts longer values: the first sign-in uses ADMIN_SECRET from the server. */
export const ADMIN_LOGIN_PASSWORD_MAX = 256
export const ADMIN_LOGIN_USERNAME_MAX = 64

const USERNAME_RE = /^[a-z0-9._-]+$/
// RegExp constructors: the tsconfig target (ES5) rejects the `u` flag in literals.
const LETTER_RE = new RegExp('\\p{L}', 'u')
const DIGIT_RE = new RegExp('\\p{Nd}', 'u')

/** Length in code points, like Python's len() on the server. */
function codePoints(s: string): number {
  return Array.from(s).length
}

const fail = (error: string): Validation => ({ ok: false, error })

/** Lowercased username, 3–32 characters of a–z, 0–9, '.', '_' or '-'. */
export function validateAdminUsername(input: string | null | undefined): Validation {
  const value = (input ?? '').trim().toLowerCase()
  if (!value) return fail('Please enter a username.')
  if (value.length < ADMIN_USERNAME_MIN) return fail(`Username must be at least ${ADMIN_USERNAME_MIN} characters.`)
  if (value.length > ADMIN_USERNAME_MAX) return fail(`Username must be at most ${ADMIN_USERNAME_MAX} characters.`)
  if (!USERNAME_RE.test(value)) return fail('Username can only contain letters, numbers, dots, dashes and underscores.')
  return { ok: true, value }
}

/** Which admin password rules a value meets (drives the checklist under the field). */
export function adminPasswordRules(password: string): { length: boolean; letterAndNumber: boolean } {
  const length = codePoints(password)
  return {
    length: length >= ADMIN_PASSWORD_MIN && length <= ADMIN_PASSWORD_MAX,
    letterAndNumber: LETTER_RE.test(password) && DIGIT_RE.test(password),
  }
}

/** New admin password: 10–128 characters with at least one letter and one number. */
export function validateAdminPassword(input: string | null | undefined): Validation {
  if (typeof input !== 'string' || !input) return fail('Please enter a new password.')
  const length = codePoints(input)
  if (length < ADMIN_PASSWORD_MIN) return fail(`Admin password must be at least ${ADMIN_PASSWORD_MIN} characters.`)
  if (length > ADMIN_PASSWORD_MAX) return fail(`Admin password must be at most ${ADMIN_PASSWORD_MAX} characters.`)
  if (!LETTER_RE.test(input) || !DIGIT_RE.test(input)) {
    return fail('Admin password must include at least one letter and one number.')
  }
  return { ok: true, value: input }
}
