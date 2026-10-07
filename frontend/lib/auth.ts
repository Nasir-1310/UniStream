// frontend/lib/auth.ts
//
// Browser session: the signed session token and a cached copy of the user
// live in localStorage so pages render the signed-in UI instantly, while
// useSession() re-validates against /auth/me in the background.
//
// The store is read through useSyncExternalStore: the server render (and the
// hydration pass) sees "unknown", the browser then switches to the stored
// session without a hydration mismatch, and every component using the hook
// (Navbar, the page) updates together — including across tabs.
//
// The admin dashboard has its own, separate session (lib/adminAuth.ts, its own
// storage key and token purpose); signing out here does not touch it.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { apiErrorMessage, apiErrorStatus, getMe, type PublicUser } from './api'

const TOKEN_KEY = 'us_token'
const USER_KEY = 'us_user'
const CHANGE_EVENT = 'us-session-change'
/** Where a required page sends visitors whose session ended. */
export const SESSION_EXPIRED_PATH = '/?session=expired'
/** Re-check with the API at most this often per tab unless forced. */
const FRESH_MS = 15_000

// ── Module state (one per tab) ────────────────────────────────────────────────

/** Set when a session ended on the server, so the redirect can say why. */
let expiredFlag = false
let inflight: Promise<PublicUser | null> | null = null
let lastVerifiedAt = 0
let lastVerifiedToken: string | null = null
/** Session copy used when localStorage is unavailable (blocked storage, some in-app browsers). */
const memory = new Map<string, string>()
let storageBroken = false

// ── Storage access (never throws: private mode / blocked storage) ────────────

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function read(key: string): string | null {
  if (!storageBroken) {
    try {
      const store = storage()
      if (store) return store.getItem(key)
    } catch {
      /* fall back to memory */
    }
  }
  return memory.get(key) ?? null
}

function write(key: string, value: string | null): void {
  if (value === null) memory.delete(key)
  else memory.set(key, value)
  try {
    const store = storage()
    if (!store) return
    if (value === null) store.removeItem(key)
    else store.setItem(key, value)
  } catch {
    // Quota exceeded or storage blocked: keep the session for this tab only.
    storageBroken = true
  }
}

function notify(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT))
}

function parseUser(raw: string | null): PublicUser | null {
  if (!raw) return null
  try {
    const user = JSON.parse(raw) as PublicUser
    return user && typeof user === 'object' && typeof user.id === 'string' ? user : null
  } catch {
    return null
  }
}

// ── Imperative API ────────────────────────────────────────────────────────────

/** The session token, or null when signed out. Sent as `Authorization: Bearer`. */
export function getToken(): string | null {
  return read(TOKEN_KEY)
}

/** The last user object the API returned, or null. May be slightly stale. */
export function getCachedUser(): PublicUser | null {
  return read(TOKEN_KEY) ? parseUser(read(USER_KEY)) : null
}

/** Store a new session (after login, reset-password or change-password). */
export function setSession(token: string, user: PublicUser): void {
  expiredFlag = false
  lastVerifiedAt = Date.now()
  lastVerifiedToken = token
  write(TOKEN_KEY, token)
  write(USER_KEY, JSON.stringify(user))
  notify()
}

/** Replace the cached user (e.g. new usage after a download) and keep the token. */
export function updateCachedUser(user: PublicUser): void {
  if (!read(TOKEN_KEY)) return
  write(USER_KEY, JSON.stringify(user))
  notify()
}

/**
 * Forget the session. `expired: true` makes the next required-page redirect
 * go to `/?session=expired` so the landing page can explain why.
 */
export function clearSession(options: { expired?: boolean } = {}): void {
  if (options.expired) expiredFlag = true
  write(TOKEN_KEY, null)
  write(USER_KEY, null)
  notify()
}

/** Subscribe to session changes in this tab and others. Returns an unsubscribe function. */
export function subscribeSession(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === TOKEN_KEY || event.key === USER_KEY) listener()
  }
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

// ── Snapshot for useSyncExternalStore ─────────────────────────────────────────

interface SessionSnapshot {
  /** False during the server render and hydration pass. */
  ready: boolean
  token: string | null
  user: PublicUser | null
}

const SERVER_SNAPSHOT: SessionSnapshot = { ready: false, token: null, user: null }
let lastToken: string | null | undefined
let lastUserRaw: string | null | undefined
let lastSnapshot: SessionSnapshot = { ready: true, token: null, user: null }

// Must return the same object until storage changes, or React re-renders forever.
function getSnapshot(): SessionSnapshot {
  const token = read(TOKEN_KEY)
  const userRaw = read(USER_KEY)
  if (token !== lastToken || userRaw !== lastUserRaw) {
    lastToken = token
    lastUserRaw = userRaw
    lastSnapshot = { ready: true, token, user: token ? parseUser(userRaw) : null }
  }
  return lastSnapshot
}

function getServerSnapshot(): SessionSnapshot {
  return SERVER_SNAPSHOT
}

// ── Revalidation (shared by every mounted hook) ───────────────────────────────

/**
 * Fetch /auth/me and update the cache. Resolves to the user, or null when
 * there is no session or it was rejected (the session is then cleared).
 * Network errors reject, leaving the cached session in place.
 */
export function refreshSession(force = false): Promise<PublicUser | null> {
  const token = getToken()
  if (!token) return Promise.resolve(null)
  if (inflight) return inflight
  if (!force && token === lastVerifiedToken && Date.now() - lastVerifiedAt < FRESH_MS) {
    return Promise.resolve(getCachedUser())
  }
  inflight = getMe({ skipAuthRedirect: true })
    .then(({ user }) => {
      // A sign-out or new sign-in while the request ran wins over its answer.
      if (getToken() === token) {
        updateCachedUser(user)
        lastVerifiedAt = Date.now()
        lastVerifiedToken = token
      }
      return user
    })
    .catch((err: unknown) => {
      const status = apiErrorStatus(err)
      // 401: expired/revoked (password changed elsewhere); 403: blocked or
      // moved back to pending by the admin. Either way this session is over.
      if ((status === 401 || status === 403) && getToken() === token) {
        clearSession({ expired: true })
        return null
      }
      throw err
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseSessionOptions {
  /** Redirect away when there is no session (default false). */
  required?: boolean
  /** Where `required` redirects; default "/" (or "/?session=expired" after an expiry). */
  redirectTo?: string
}

export interface SessionState {
  /** The signed-in user (cached instantly, then refreshed), or null. */
  user: PublicUser | null
  /**
   * The raw session token, or null. lib/api.ts sends it as a Bearer header;
   * never put it in a URL (the download stream uses createDownloadTicket()).
   */
  token: string | null
  /**
   * True until we know whether someone is signed in: during hydration, and
   * while a token exists without a cached user. Never true when signed out.
   */
  loading: boolean
  /** Message when /auth/me failed for a reason other than an ended session (e.g. offline). */
  error: string | null
  /** Re-fetch /auth/me now. Resolves to the fresh user (null if the session ended). */
  refresh: () => Promise<PublicUser | null>
  /** Clear the session and go to the landing page. */
  signOut: () => void
  /** Replace the cached user, e.g. with `{ ...user, usage }` after a download. */
  setUser: (user: PublicUser) => void
}

/**
 * Current session for client components.
 *
 * ```tsx
 * const { user, loading, signOut } = useSession({ required: true })
 * if (loading || !user) return <PageLoader />
 * ```
 */
export function useSession(options: UseSessionOptions = {}): SessionState {
  const { required = false, redirectTo } = options
  const router = useRouter()
  const snapshot = useSyncExternalStore(subscribeSession, getSnapshot, getServerSnapshot)
  const [error, setError] = useState<string | null>(null)
  const { ready, token, user } = snapshot

  // Revalidate in the background whenever a (new) token appears.
  useEffect(() => {
    if (!token) return
    let active = true
    refreshSession()
      .then(() => {
        if (active) setError(null)
      })
      .catch((err: unknown) => {
        if (active) setError(errorText(err))
      })
    return () => {
      active = false
    }
  }, [token])

  useEffect(() => {
    if (!required || !ready || token) return
    const target = expiredFlag ? SESSION_EXPIRED_PATH : redirectTo ?? '/'
    expiredFlag = false
    router.replace(target)
  }, [required, ready, token, redirectTo, router])

  const refresh = useCallback(async () => {
    try {
      const fresh = await refreshSession(true)
      setError(null)
      return fresh
    } catch (err) {
      setError(errorText(err))
      throw err
    }
  }, [])

  const signOut = useCallback(() => {
    expiredFlag = false
    clearSession()
    router.replace('/')
  }, [router])

  const setUser = useCallback((next: PublicUser) => updateCachedUser(next), [])

  return {
    user,
    token,
    // Signed in without a cached user (first load after an old cache): wait
    // for /auth/me, unless it failed, in which case `error` explains why.
    loading: !ready || (Boolean(token) && !user && !error),
    error,
    refresh,
    signOut,
    setUser,
  }
}

function errorText(err: unknown): string {
  return apiErrorMessage(err, 'Could not check your session. Please try again.')
}
