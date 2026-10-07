'use client'
// components/admin/hooks.ts

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { apiErrorMessage } from '@/lib/api'
import { useAdmin } from './AdminContext'

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
 * filter and relevant revision counter in it). A 401 signs the admin out.
 * Responses for an older key are ignored, so fast filter changes can't show
 * results for the wrong filter.
 */
export function useAdminQuery<T>(
  key: string,
  fetcher: (secret: string) => Promise<T>,
  options: { enabled?: boolean } = {},
): AdminQuery<T> {
  const { secret, handleAuthError } = useAdmin()
  return useSecretQuery(secret, handleAuthError, key, fetcher, options)
}

/**
 * useAdminQuery for the shell itself, which provides the context and so
 * can't read it: takes the secret and the 401 handler explicitly.
 */
export function useSecretQuery<T>(
  secret: string,
  handleAuthError: (err: unknown) => boolean,
  key: string,
  fetcher: (secret: string) => Promise<T>,
  options: { enabled?: boolean } = {},
): AdminQuery<T> {
  const enabled = options.enabled ?? true
  const [reloads, setReloads] = useState(0)
  const requestKey = enabled ? `${key}#${reloads}` : null
  const [state, setState] = useState<QueryState<T>>({ requestKey: null, data: undefined, error: null, updatedAt: 0 })

  // The latest fetcher without making it an effect dependency (callers pass inline closures).
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    if (requestKey === null) return
    let active = true
    fetcherRef.current(secret).then(
      data => {
        if (active) setState({ requestKey, data, error: null, updatedAt: Date.now() })
      },
      (err: unknown) => {
        if (!active || handleAuthError(err)) return
        setState(prev => ({ ...prev, requestKey, error: apiErrorMessage(err) }))
      },
    )
    return () => {
      active = false
    }
  }, [requestKey, secret, handleAuthError])

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
