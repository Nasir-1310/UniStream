// frontend/lib/validation.ts
//
// Client-side mirrors of backend/security.py. The messages are identical on
// purpose: a field shows the same hint whether the browser or the API caught
// the problem. When a rule changes there, change it here too.

/** Field limits shared with the backend. */
export const NAME_MIN = 2
export const NAME_MAX = 80
export const EMAIL_MAX = 254
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128
/** Largest custom per-user / default daily download limit the API accepts. */
export const DAILY_LIMIT_MAX = 10000

/**
 * Outcome of a validator: the normalised value to send to the API, or the
 * user-facing error message to show next to the field.
 */
export type Validation<T = string> = Valid<T> | Invalid
export type Valid<T> = { ok: true; value: T; error?: undefined }
export type Invalid = { ok: false; value?: undefined; error: string }

const ok = <T,>(value: T): Valid<T> => ({ ok: true, value })
const fail = (error: string): Invalid => ({ ok: false, error })

/** Error text of a validation, or null when valid. Handy for `aria-invalid`. */
export function errorOf(result: Validation<unknown>): string | null {
  return result.ok ? null : result.error
}

// Built with the RegExp constructor: the `u` flag and \p{…} escapes are fine in
// every supported browser, but TypeScript rejects them as literals for the
// project's ES5 compile target.
const LETTER_RE = new RegExp('\\p{L}', 'u')
const DIGIT_RE = new RegExp('\\p{Nd}', 'u')
const UPPER_RE = new RegExp('\\p{Lu}', 'u')
const LOWER_RE = new RegExp('\\p{Ll}', 'u')
const SYMBOL_RE = new RegExp('[^\\p{L}\\p{Nd}]', 'u')
// Control characters plus the bidi overrides/isolates the backend rejects
// (they can make a name render as different text in the admin panel).
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/

/** Length in code points, matching Python's len() for non-BMP characters. */
function codePoints(s: string): number {
  return Array.from(s).length
}

// ── Name ──────────────────────────────────────────────────────────────────────

/** Full name: trimmed, inner whitespace collapsed, 2–80 chars, must contain letters. */
export function validateName(input: string | null | undefined): Validation {
  if (typeof input !== 'string') return fail('Please enter your full name.')
  const name = input.trim().split(/\s+/).filter(Boolean).join(' ')
  if (!name) return fail('Please enter your full name.')
  if (CONTROL_RE.test(name)) return fail('Name contains invalid characters.')
  if (codePoints(name) < NAME_MIN) return fail(`Name must be at least ${NAME_MIN} characters.`)
  if (codePoints(name) > NAME_MAX) return fail(`Name must be at most ${NAME_MAX} characters.`)
  if (!LETTER_RE.test(name)) return fail('Name must contain letters.')
  return ok(name)
}

// ── Email ─────────────────────────────────────────────────────────────────────

// Same shape as backend/security.py _EMAIL_RE (applied to the lowercased value).
const EMAIL_RE =
  /^[a-z0-9][a-z0-9._%+\-]{0,63}@[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/

/** Email address, returned lowercased. */
export function validateEmail(input: string | null | undefined): Validation {
  if (typeof input !== 'string' || !input.trim()) return fail('Please enter your email address.')
  const email = input.trim().toLowerCase()
  if (/\s/.test(email)) return fail("Email can't contain spaces.")
  if (email.length > EMAIL_MAX) return fail('Email is too long.')
  if (!email.includes('@')) return fail('Enter a valid email address, e.g. name@gmail.com.')
  const at = email.indexOf('@')
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (domain.includes('@')) return fail('Only one @ symbol allowed.')
  if (!local) return fail('Enter a username before @.')
  if (!domain.includes('.')) return fail('Missing domain — e.g. @gmail.com')
  if (email.includes('..') || local.endsWith('.') || !EMAIL_RE.test(email)) {
    return fail('Invalid email — check the format.')
  }
  return ok(email)
}

// ── Phone ─────────────────────────────────────────────────────────────────────

// Bengali (০-৯) and Arabic-Indic digits typed on local keyboards become ASCII,
// so the normalised E.164 value the page sends is always accepted by the API.
function asciiDigits(s: string): string {
  return s
    .replace(/[০-৯]/g, d => String(d.charCodeAt(0) - 0x09e6))
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
}

/**
 * Phone number, returned in E.164 form (`+8801XXXXXXXXX`).
 *
 * Bangladeshi mobiles are accepted as 01XXXXXXXXX, 8801XXXXXXXXX or
 * +8801XXXXXXXXX (spaces, dashes, dots and brackets ignored); other countries
 * need their country code: +<7 to 15 digits>. Send `value` to the API.
 */
export function validatePhone(input: string | null | undefined): Validation {
  if (typeof input !== 'string' || !input.trim()) return fail('Please enter your phone number.')
  let compact = asciiDigits(input.trim()).replace(/[\s\-(). ]/g, '')
  if (compact.startsWith('00')) compact = '+' + compact.slice(2) // international dialling prefix
  if (!/^\+?[0-9]+$/.test(compact)) {
    return fail('Phone number can only contain digits, spaces, dashes and a leading +.')
  }

  const hasPlus = compact.startsWith('+')
  const digits = compact.replace(/^\++/, '')

  if (hasPlus && !digits.startsWith('880')) {
    if (digits.startsWith('0')) {
      return fail('Invalid country code — write international numbers as +<country code><number>.')
    }
    if (digits.length < 7) return fail('Too short — international numbers need 7 to 15 digits after the +.')
    if (digits.length > 15) return fail('Too long — international numbers have at most 15 digits after the +.')
    return ok('+' + digits)
  }

  let national = digits
  if (digits.startsWith('880')) {
    const rest = digits.slice(3)
    // Accept both +880 1XXXXXXXXX (E.164) and the common +880 01XXXXXXXXX.
    national = rest.startsWith('0') ? rest : '0' + rest
  }

  if (national.length < 11) return fail('Too short — Bangladeshi numbers need 11 digits, e.g. 017XXXXXXXX.')
  if (national.length > 11) return fail('Too long — Bangladeshi numbers have 11 digits, e.g. 017XXXXXXXX.')
  if (!national.startsWith('01')) {
    return fail(
      'Must start with 01, e.g. 017XXXXXXXX. For numbers outside Bangladesh, add the country code, e.g. +44…',
    )
  }
  if (!'3456789'.includes(national.charAt(2))) {
    return fail('Unknown operator — Bangladeshi mobile numbers start with 013–019.')
  }
  return ok('+880' + national.slice(1))
}

/** E.164 form of a phone number (BD local `017…` → `+88017…`), or null when invalid. */
export function normalizePhone(input: string | null | undefined): string | null {
  const result = validatePhone(input)
  return result.ok ? result.value : null
}

// ── Sign-in value ─────────────────────────────────────────────────────────────

/** What a sign-in value was recognised as. */
export type LoginKind = 'email' | 'phone'

/**
 * Normalise a sign-in value: the lowercased email when it contains '@',
 * otherwise the E.164 phone. `kind` tells which one it was.
 */
export function classifyLogin(
  input: string | null | undefined,
): Validation<string> & { kind?: LoginKind } {
  if (typeof input !== 'string' || !input.trim()) return fail('Enter your email address or phone number.')
  const value = asciiDigits(input.trim())
  if (value.includes('@')) return { ...validateEmail(value), kind: 'email' }
  if (!/^[0-9+(]/.test(value)) return fail('Enter a valid email address or phone number.')
  return { ...validatePhone(value), kind: 'phone' }
}

// ── Password ──────────────────────────────────────────────────────────────────

/** New password: 8–128 characters with at least one letter and one number. Returned unchanged. */
export function validatePassword(input: string | null | undefined): Validation {
  if (typeof input !== 'string' || !input) return fail('Please enter a password.')
  const length = codePoints(input)
  if (length < PASSWORD_MIN) return fail(`Password must be at least ${PASSWORD_MIN} characters.`)
  if (length > PASSWORD_MAX) return fail(`Password must be at most ${PASSWORD_MAX} characters.`)
  if (!LETTER_RE.test(input) || !DIGIT_RE.test(input)) {
    return fail('Password must include at least one letter and one number.')
  }
  return ok(input)
}

/** Confirmation field check for "new password" + "confirm password" forms. */
export function validatePasswordConfirm(password: string, confirm: string): Validation {
  if (!confirm) return fail('Please confirm your new password.')
  if (password !== confirm) return fail("Passwords don't match.")
  return ok(confirm)
}

/** 0 = very weak … 4 = strong. */
export type StrengthScore = 0 | 1 | 2 | 3 | 4

export interface PasswordStrength {
  score: StrengthScore
  /** "Very weak" | "Weak" | "Fair" | "Good" | "Strong" */
  label: string
  /** One short suggestion for improving it; empty when strong. */
  hint: string
}

const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'] as const

// Passwords (and stems) that guessing tools try first. Kept short: the
// meter is a nudge, the backend rules are the real gate.
const COMMON_PASSWORDS = [
  'password', 'passw0rd', 'qwerty', 'qwertyuiop', 'asdfgh', 'zxcvbn', 'abc123',
  'letmein', 'welcome', 'iloveyou', 'admin', 'monkey', 'dragon', 'football',
  'bangladesh', 'dhaka', 'student', 'university', 'unistream', 'login',
  '123456', '12345678', '123456789', '1234567890', '111111', '000000',
]

function hasSequence(pw: string, run = 4): boolean {
  const s = pw.toLowerCase()
  let up = 1
  let down = 1
  for (let i = 1; i < s.length; i++) {
    const delta = s.charCodeAt(i) - s.charCodeAt(i - 1)
    up = delta === 1 ? up + 1 : 1
    down = delta === -1 ? down + 1 : 1
    if (up >= run || down >= run) return true
  }
  return false
}

/**
 * Rough strength estimate for a strength meter. Anything failing
 * validatePassword() scores at most 1.
 */
export function passwordStrength(pw: string): PasswordStrength {
  if (!pw) return { score: 0, label: STRENGTH_LABELS[0], hint: `Use at least ${PASSWORD_MIN} characters.` }

  const length = codePoints(pw)
  const lower = pw.toLowerCase()
  const classes = [
    LOWER_RE.test(pw),
    UPPER_RE.test(pw),
    DIGIT_RE.test(pw),
    SYMBOL_RE.test(pw),
  ].filter(Boolean).length

  let score = 0
  if (length >= PASSWORD_MIN) score += 1
  if (length >= 12) score += 1
  if (length >= 16) score += 1
  if (classes >= 3) score += 1
  if (classes === 4) score += 1

  let hint = ''
  const isCommon = COMMON_PASSWORDS.some(word => lower.includes(word))
  if (isCommon) {
    score -= 2
    hint = 'Avoid common words like "password" or "123456".'
  }
  if (/(.)\1\1/.test(pw)) {
    score -= 1
    hint = hint || 'Avoid repeating the same character.'
  }
  if (hasSequence(pw)) {
    score -= 1
    hint = hint || 'Avoid sequences like "abcd" or "1234".'
  }

  const valid = validatePassword(pw)
  if (!valid.ok) {
    score = Math.min(score, 1)
    hint = valid.error
  }

  const clamped = Math.max(0, Math.min(4, score)) as StrengthScore
  if (!hint && clamped < 4) {
    hint = length < 12
      ? 'Longer is stronger — try 12 or more characters.'
      : 'Mix upper and lower case letters, numbers and symbols.'
  }
  return { score: clamped, label: STRENGTH_LABELS[clamped], hint }
}

// ── Daily limit (admin) ───────────────────────────────────────────────────────

/** Whole number of downloads per day, 0–10000 (0 pauses downloads for the user). */
export function validateDailyLimit(input: string | number | null | undefined): Validation<number> {
  const raw = typeof input === 'number' ? String(input) : (input ?? '').trim()
  if (!raw) return fail('Enter a daily download limit.')
  if (!/^\d+$/.test(raw)) return fail('Use a whole number, e.g. 4.')
  const value = Number(raw)
  if (value > DAILY_LIMIT_MAX) return fail(`The limit can be at most ${DAILY_LIMIT_MAX.toLocaleString('en-US')}.`)
  return ok(value)
}

// ── Video links ───────────────────────────────────────────────────────────────

/** Platforms the downloader accepts. */
export type Platform = 'youtube' | 'facebook' | 'instagram'

export const PLATFORMS: readonly Platform[] = ['youtube', 'facebook', 'instagram']

export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  instagram: 'Instagram',
}

/** Same text as the API's 400 for other sites. */
export const UNSUPPORTED_URL_MESSAGE = 'Only YouTube, Facebook and Instagram links are supported.'

// Registrable domains per platform; any subdomain (www., m., music., web.) counts.
const PLATFORM_DOMAINS: Record<Platform, readonly string[]> = {
  youtube: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
  facebook: ['facebook.com', 'fb.watch', 'fb.com'],
  instagram: ['instagram.com', 'instagr.am'],
}

/** Platform of an http(s) link, or null for anything else (mirrors detect_platform). */
export function detectPlatform(url: string | null | undefined): Platform | null {
  if (typeof url !== 'string') return null
  const value = url.trim()
  if (!value || value.length > 4096 || /[\s\u0000-\u001f]/.test(value)) return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const host = parsed.hostname.replace(/\.+$/, '').toLowerCase()
  if (!host) return null
  for (const platform of PLATFORMS) {
    for (const domain of PLATFORM_DOMAINS[platform]) {
      if (host === domain || host.endsWith('.' + domain)) return platform
    }
  }
  return null
}

/**
 * Check a pasted video link before analysing it. Adds a missing `https://`
 * (people often copy "youtube.com/watch?v=…" without it); send `value`.
 */
export function validateVideoUrl(
  input: string | null | undefined,
): Validation<string> & { platform?: Platform } {
  const raw = (input ?? '').trim()
  if (!raw) return fail('Paste a video link first.')
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`
  const platform = detectPlatform(url)
  if (!platform) return fail(UNSUPPORTED_URL_MESSAGE)
  return { ok: true, value: url, platform }
}
