'use client'
// components/admin/hooks.ts

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { apiErrorMessage, apiErrorStatus } from '@/lib/api'
import { getAdminToken, useAdminSession } from '@/lib/adminAuth'

/**
 * True when `err` is a 401 that ended the admin session. lib/api has already
 * cleared it and AdminApp is swapping to the sign-in screen, so callers skip
 * their own error message. A 401 for a token that was replaced meanwhile
 * (e.g. right after changing the password) does not end the session and is
 * reported like any other error.
 */
export function isAdminSessionEnded(err: unknown): boolean {
  return apiErrorStatus(err) === 401 && getAdminToken() === null
}

interface QueryState<T> {
  /** Request the stored result answers; differs from the current one while loading. */
  requestKey: string | null
  data: T | undefined
  error: string | null
  updatedAt: number
}

export interface AdminQuery<T> {
  /** Latest successful result — kept while a new page/filter loads so the layout doesn't jump. */
  data: T | undefined
  /** Message of the last failure for the current request (null while loading). */
  error: string | null
  loading: boolean
  /** True while showing data from an earlier request (dim it). */
  stale: boolean
  /** ms timestamp of the last success. */
  updatedAt: number
  reload: () => void
  /** Patch the cached data locally (e.g. replace one edited row). */
  mutate: (update: (data: T) => T) => void
}

/**
 * Fetch admin data for `key`; refetches whenever the key changes (put every
 * filter and relevant revision counter in it). Responses for an older key are
 * ignored, so fast filter changes can't show results for the wrong filter.
 *
 * lib/api adds the admin token to the request. The token is part of the
 * request key, so new credentials refetch everything under the new session,
 * and nothing is fetched while signed out. Works outside the dashboard shell
 * too (the first-sign-in setup screen).
 */
export function useAdminQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: { enabled?: boolean } = {},
): AdminQuery<T> {
  const token = useAdminSession().session?.token ?? null
  const enabled = (options.enabled ?? true) && token !== null
  const [reloads, setReloads] = useState(0)
  const requestKey = enabled ? `${key}#${reloads}#${token}` : null
  const [state, setState] = useState<QueryState<T>>({ requestKey: null, data: undefined, error: null, updatedAt: 0 })

  // The latest fetcher without making it an effect dependency (callers pass inline closures).
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    if (requestKey === null) return
    let active = true
    fetcherRef.current().then(
      data => {
        if (active) setState({ requestKey, data, error: null, updatedAt: Date.now() })
      },
      (err: unknown) => {
        if (!active || isAdminSessionEnded(err)) return
        setState(prev => ({ ...prev, requestKey, error: apiErrorMessage(err) }))
      },
    )
    return () => {
      active = false
    }
  }, [requestKey])

  const reload = useCallback(() => setReloads(n => n + 1), [])
  const mutate = useCallback((update: (data: T) => T) => {
    setState(prev => (prev.data === undefined ? prev : { ...prev, data: update(prev.data) }))
  }, [])

  const loading = requestKey !== null && state.requestKey !== requestKey
  return {
    data: state.data,
    error: loading ? null : state.error,
    loading,
    stale: loading && state.data !== undefined,
    updatedAt: state.updatedAt,
    reload,
    mutate,
  }
}

/** `value`, updated only after it stopped changing for `delay` ms (search boxes). */
export function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** Run an async action while tracking which item is busy (row spinners, disabled buttons). */
export function useBusy() {
  const [busy, setBusy] = useState<Record<string, string>>({})
  const run = useCallback(async <R,>(id: string, label: string, action: () => Promise<R>): Promise<R> => {
    setBusy(current => ({ ...current, [id]: label }))
    try {
      return await action()
    } finally {
      setBusy(current => {
        const next = { ...current }
        delete next[id]
        return next
      })
    }
  }, [])
  return { busy, run }
}

// ── Clock ─────────────────────────────────────────────────────────────────────
// A coarse external store, so components can show "now" without calling
// Date.now() during render. The server snapshot (0) never renders a time.

function clockStore(intervalMs: number) {
  return {
    subscribe(callback: () => void) {
      const id = window.setInterval(callback, intervalMs)
      return () => window.clearInterval(id)
    },
    read: () => Math.floor(Date.now() / intervalMs) * intervalMs,
  }
}

const CLOCKS = { second: clockStore(1000), halfMinute: clockStore(30_000) }
const serverClock = () => 0

/** Current time in ms, refreshed every second or every 30 s. */
export function useClock(precision: keyof typeof CLOCKS = 'halfMinute'): number {
  const store = CLOCKS[precision]
  return useSyncExternalStore(store.subscribe, store.read, serverClock)
}
