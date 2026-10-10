// frontend/lib/format.ts
//
// Display formatters shared by every page. All accept null/undefined and
// return a placeholder instead of throwing, because API fields such as
// last_login_at or file_size are often empty.

/** Shown for missing values in tables and detail lists. */
export const EMPTY = '—'

type DateInput = string | number | Date | null | undefined

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** 1536 → "1.5 KB", 0 → "0 B", null → "—". Binary units, like the API's sizes. */
export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return EMPTY
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : decimals)} ${units[unit]}`
}

export interface DateFormatOptions {
  /** Include the time of day (default true). */
  time?: boolean
  /** IANA zone, e.g. "Asia/Dhaka"; defaults to the browser's zone. */
  timeZone?: string
}

/** "6 Oct 2026, 4:05 pm" (or "6 Oct 2026" with `time: false`); "—" when empty. */
export function formatDate(value: DateInput, options: DateFormatOptions = {}): string {
  const date = toDate(value)
  if (!date) return EMPTY
  const { time = true, timeZone } = options
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(time ? { hour: 'numeric', minute: '2-digit', hour12: true } : {}),
      ...(timeZone ? { timeZone } : {}),
    })
      .format(date)
      .replace('Sept', 'Sep') // newer ICU data abbreviates September as "Sept"
  } catch {
    return date.toLocaleString()
  }
}

/** Time of day only: "12:00 am", "4:05 pm". */
export function formatTime(value: DateInput, timeZone?: string): string {
  const date = toDate(value)
  if (!date) return EMPTY
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      ...(timeZone ? { timeZone } : {}),
    }).format(date)
  } catch {
    return date.toLocaleTimeString()
  }
}

/**
 * Relative time: "just now", "3 min ago", "5 h ago", "yesterday", "4 days ago",
 * or "in 20 min" for future instants; falls back to a date after a week.
 * Pass `now` (ms) to keep a list consistent or to make output testable.
 */
export function formatRelative(value: DateInput, now: number = Date.now()): string {
  const date = toDate(value)
  if (!date) return EMPTY
  const diffSeconds = Math.round((now - date.getTime()) / 1000)
  const future = diffSeconds < 0
  const seconds = Math.abs(diffSeconds)
  const wrap = (text: string) => (future ? `in ${text}` : `${text} ago`)

  if (seconds < 45) return future ? 'in a moment' : 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return wrap(`${minutes} min`)
  const hours = Math.round(seconds / 3600)
  if (hours < 24) return wrap(`${hours} h`)
  const days = Math.round(seconds / 86400)
  if (days === 1) return future ? 'tomorrow' : 'yesterday'
  if (days < 7) return wrap(`${days} days`)
  return formatDate(date, { time: false })
}

/** Time left until an instant: "7 h 20 min", "45 min", "less than a minute". */
export function formatTimeUntil(value: DateInput, now: number = Date.now()): string {
  const date = toDate(value)
  if (!date) return EMPTY
  const minutes = Math.ceil((date.getTime() - now) / 60000)
  if (minutes <= 1) return 'less than a minute'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

// ── Bangla variants for the public site (the admin panel stays English) ──────
// Latin digits are kept on purpose: sizes, qualities and percentages are shown
// that way everywhere on the site.

/** Bangla time left: "7 ঘণ্টা 20 মিনিট", "45 মিনিট", "এক মিনিটেরও কম". */
export function formatTimeUntilBn(value: DateInput, now: number = Date.now()): string {
  const date = toDate(value)
  if (!date) return EMPTY
  const minutes = Math.ceil((date.getTime() - now) / 60000)
  if (minutes <= 1) return 'এক মিনিটেরও কম'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} মিনিট`
  return m === 0 ? `${h} ঘণ্টা` : `${h} ঘণ্টা ${m} মিনিট`
}

/** Bangla date: "6 অক্টোবর, 2026" (with time: "6 অক্টোবর, 2026, 4:05 PM"). */
export function formatDateBn(value: DateInput, options: DateFormatOptions = {}): string {
  const date = toDate(value)
  if (!date) return EMPTY
  const { time = true, timeZone } = options
  try {
    return new Intl.DateTimeFormat('bn-BD-u-nu-latn', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      ...(time ? { hour: 'numeric', minute: '2-digit', hour12: true } : {}),
      ...(timeZone ? { timeZone } : {}),
    }).format(date)
  } catch {
    return formatDate(date, options)
  }
}

/** Bangla relative time: "এইমাত্র", "3 মিনিট আগে", "5 ঘণ্টা আগে", "গতকাল", "4 দিন আগে". */
export function formatRelativeBn(value: DateInput, now: number = Date.now()): string {
  const date = toDate(value)
  if (!date) return EMPTY
  const diffSeconds = Math.round((now - date.getTime()) / 1000)
  const future = diffSeconds < 0
  const seconds = Math.abs(diffSeconds)
  const wrap = (text: string) => (future ? `${text} পর` : `${text} আগে`)
  if (seconds < 45) return future ? 'কিছুক্ষণ পর' : 'এইমাত্র'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return wrap(`${minutes} মিনিট`)
  const hours = Math.round(seconds / 3600)
  if (hours < 24) return wrap(`${hours} ঘণ্টা`)
  const days = Math.round(seconds / 86400)
  if (days === 1) return future ? 'আগামীকাল' : 'গতকাল'
  if (days < 7) return wrap(`${days} দিন`)
  return formatDateBn(date, { time: false })
}

/** "3টি ডাউনলোড": Bangla has no plural forms, only the counter -টি. */
export function countBn(count: number, noun: string): string {
  return `${formatNumber(count)}টি ${noun}`
}

/** Seconds → "4:05" or "1:02:03"; empty string for 0/unknown (live streams, images). */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

/** 12345 → "12,345". */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY
  return value.toLocaleString('en-US')
}

/** 1234 → "1.2K", 3400000 → "3.4M" (view and like counts). */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(value)
}

/** "1 download" / "3 downloads"; pass `plural` for irregular words. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`
}

/**
 * Readable phone number: "+8801712345678" → "+880 1712-345678";
 * other numbers are returned as stored.
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return EMPTY
  const bd = /^\+880(1\d{3})(\d{6})$/.exec(value)
  return bd ? `+880 ${bd[1]}-${bd[2]}` : value
}

/** A daily limit for display: null → "Unlimited", 4 → "4 / day". */
export function formatLimit(limit: number | null | undefined): string {
  if (limit === null || limit === undefined || limit < 0) return 'Unlimited'
  return `${formatNumber(limit)} / day`
}

/** Usage shape shared with lib/api's Usage (kept structural to avoid an import cycle). */
interface UsageLike {
  used: number
  limit: number | null
  remaining: number | null
}

/** "2 of 4 downloads used today", or "3 downloads today · Unlimited". */
export function formatUsage(usage: UsageLike | null | undefined): string {
  if (!usage) return EMPTY
  if (usage.limit === null) return `${pluralize(usage.used, 'download')} today · Unlimited`
  return `${formatNumber(usage.used)} of ${pluralize(usage.limit, 'download')} used today`
}

/** 0–100 share of today's limit used (0 for unlimited); for progress bars. */
export function usagePercent(usage: UsageLike | null | undefined): number {
  if (!usage || usage.limit === null) return 0
  if (usage.limit <= 0) return 100
  return Math.max(0, Math.min(100, Math.round((usage.used / usage.limit) * 100)))
}

/** Date → "YYYY-MM-DD" in the browser's zone, for <input type="date"> values and API filters. */
export function toDateInputValue(value: Date = new Date()): string {
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Up to two initials for an avatar: "Nasir Uddin" → "NU", "rafi@x.com" → "R". */
export function initials(name: string | null | undefined, fallback = '?'): string {
  const words = (name ?? '').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  if (!words.length) return fallback
  const letters = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]]
  return letters.map(word => Array.from(word)[0]?.toUpperCase() ?? '').join('') || fallback
}
