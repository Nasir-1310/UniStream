// frontend/lib/adminAuth.ts
//
// Admin session for /admin: the signed admin token from POST /admin/auth/login.
//
// It lives in sessionStorage by default, so it ends with the tab on a shared
// university computer, and in localStorage only when the admin ticks "Keep me
// signed in on this device". Exactly one of the two holds it at a time. The
// admin session is separate from the user session in lib/auth.ts: different
// storage key, different token purpose, never sent to user endpoints.
//
// lib/api.ts reads getAdminToken() for every /admin/* request and calls
// expireAdminSession() when one comes back 401, which clears the session and
// fires ADMIN_SESSION_EXPIRED_EVENT so the admin UI can show its sign-in
// screen in place (no redirect).

import { useSyncExternalStore } from 'react'

const KEY = 'us_admin_session'
const CHANGE_EVENT = 'unistream:admin-session-change'
/** Fired on `window` when the server rejects the admin token. `detail` is AdminSessionExpiredDetail. */
export const ADMIN_SESSION_EXPIRED_EVENT = 'unistream:admin-session-expired'
export const ADMIN_SESSION_EXPIRED_MESSAGE = 'Your admin session has expired. Please sign in again.'
/**
 * The server is the authority on expiry; this only stops a week-old
 * remembered session from flashing the dashboard before its first 401.
 * The slack keeps a client clock that runs a little fast from signing out early.
 */
const EXPIRY_SLACK_MS = 60_000

/** What POST /admin/auth/login and /admin/auth/change-credentials return. */
export interface AdminAuthResponse {
  token: string
  username: string
  /** True while signed in with the bootstrap password (ADMIN_SECRET / ADMIN_PASSWORD). */
  must_change_password: boolean
  /** ISO instant the token stops working (12 hours, or 7 days when remembered). */
  expires_at: string
}

/** The stored admin session. */
export interface AdminSession extends AdminAuthResponse {
  /** True when kept in localStorage ("Keep me signed in on this device"). */
  remember: boolean
}

export interface AdminSessionExpiredDetail {
  message: string
}

// ── Storage access (never throws: private mode / blocked storage) ────────────

/** Copy used when web storage is blocked (strict in-app browsers); this tab only. */
let memory: string | null = null
/** Why the last session ended on the server; cleared by the next sign-in. */
let expiredMessage: string | null = null

function store(kind: 'session' | 'local'): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return kind === 'session' ? window.sessionStorage : window.localStorage
  } catch {
    return null
  }
}

function readRaw(): string | null {
  for (const kind of ['session', 'local'] as const) {
    try {
      const value = store(kind)?.getItem(KEY)
      if (value) return value
    } catch {
      /* try the next store */
    }
  }
  return memory
}

function writeRaw(value: string | null, remember: boolean): void {
  memory = value
  const target = remember ? 'local' : 'session'
  for (const kind of ['session', 'local'] as const) {
    try {
      const s = store(kind)
      if (!s) continue
      if (value !== null && kind === target) s.setItem(KEY, value)
      else s.removeItem(KEY)
    } catch {
      // Storage blocked or full: the in-memory copy keeps this tab signed in.
    }
  }
}

function notify(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT))
}

function parseSession(raw: string | null): AdminSession | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<AdminSession> | null
    if (!value || typeof value !== 'object' || typeof value.token !== 'string' || !value.token) return null
    const session: AdminSession = {
      token: value.token,
      username: typeof value.username === 'string' ? value.username : '',
      must_change_password: value.must_change_password === true,
      expires_at: typeof value.expires_at === 'string' ? value.expires_at : '',
      remember: value.remember === true,
    }
    const expires = Date.parse(session.expires_at)
    if (Number.isFinite(expires) && Date.now() > expires + EXPIRY_SLACK_MS) return null
    return session
  } catch {
    return null
  }
}

// ── Imperative API ────────────────────────────────────────────────────────────

/** The stored admin session, or null when signed out (or past its expiry). */
export function getAdminSession(): AdminSession | null {
  return parseSession(readRaw())
}

/** The admin Bearer token, or null. lib/api.ts sends it on every /admin/* call. */
export function getAdminToken(): string | null {
  return getAdminSession()?.token ?? null
}

/**
 * Store a session from login or change-credentials. `remember` picks
 * localStorage over sessionStorage; omit it to keep the current choice
 * (change-credentials keeps whatever the admin chose at sign-in).
 */
export function setAdminSession(auth: AdminAuthResponse, remember?: boolean): AdminSession {
  const session: AdminSession = {
    token: auth.token,
    username: auth.username,
    must_change_password: auth.must_change_password === true,
    expires_at: auth.expires_at,
    remember: remember ?? getAdminSession()?.remember ?? false,
  }
  expiredMessage = null
  writeRaw(JSON.stringify(session), session.remember)
  notify()
  return session
}

/** Update the stored username / must-change flag (e.g. from GET /admin/auth/me) and keep the token. */
export function updateAdminSession(patch: Partial<Pick<AdminSession, 'username' | 'must_change_password'>>): void {
  const current = getAdminSession()
  if (!current) return
  const next: AdminSession = { ...current, ...patch }
  if (next.username === current.username && next.must_change_password === current.must_change_password) return
  writeRaw(JSON.stringify(next), next.remember)
  notify()
}

/** Sign out of the admin dashboard on this device (both storages). */
export function clearAdminSession(): void {
  expiredMessage = null
  writeRaw(null, false)
  notify()
}

/**
 * The server rejected the admin token: forget it and tell the admin UI, which
 * listens for ADMIN_SESSION_EXPIRED_EVENT (or reads `expiredMessage` from
 * useAdminSession) to show the sign-in screen with a "Session expired" notice.
 */
export function expireAdminSession(message: string = ADMIN_SESSION_EXPIRED_MESSAGE): void {
  writeRaw(null, false)
  expiredMessage = message
  notify()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<AdminSessionExpiredDetail>(ADMIN_SESSION_EXPIRED_EVENT, { detail: { message } }),
    )
  }
}

/** Run `listener` whenever the admin session expires. Returns an unsubscribe function. */
export function onAdminSessionExpired(listener: (detail: AdminSessionExpiredDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<AdminSessionExpiredDetail>).detail
    listener(detail ?? { message: ADMIN_SESSION_EXPIRED_MESSAGE })
  }
  window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, handler)
  return () => window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, handler)
}

/** Subscribe to admin session changes in this tab (and remembered sessions in other tabs). */
export function subscribeAdminSession(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === KEY) listener()
  }
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener)
    window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface AdminSessionState {
  /** False during the server render and hydration pass: render a loader, not the login form. */
  ready: boolean
  /** The signed-in admin, or null. */
  session: AdminSession | null
  /** Set after a 401 ended the session (show it on the sign-in screen); null after the next sign-in. */
  expiredMessage: string | null
}

const SERVER_STATE: AdminSessionState = { ready: false, session: null, expiredMessage: null }
let lastRaw: string | null | undefined
let lastExpired: string | null | undefined
let lastState: AdminSessionState = { ready: true, session: null, expiredMessage: null }

// Must return the same object until something changes, or React re-renders forever.
function getSnapshot(): AdminSessionState {
  const raw = readRaw()
  if (raw !== lastRaw || expiredMessage !== lastExpired) {
    lastRaw = raw
    lastExpired = expiredMessage
    lastState = { ready: true, session: parseSession(raw), expiredMessage }
  }
  return lastState
}

function getServerSnapshot(): AdminSessionState {
  return SERVER_STATE
}

/**
 * Current admin session for client components; re-renders on sign-in,
 * sign-out, credential changes and expiry.
 *
 * ```tsx
 * const { ready, session, expiredMessage } = useAdminSession()
 * if (!ready) return <PageLoader />
 * if (!session) return <AdminLogin notice={expiredMessage} />
 * ```
 */
export function useAdminSession(): AdminSessionState {
  return useSyncExternalStore(subscribeAdminSession, getSnapshot, getServerSnapshot)
}
