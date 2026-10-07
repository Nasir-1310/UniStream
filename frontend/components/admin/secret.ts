// components/admin/secret.ts
//
// The admin secret lives in sessionStorage: it survives a reload but not
// closing the tab, and never reaches localStorage where it would outlive the
// session on a shared university computer. Read through useSyncExternalStore
// so the server render (and hydration) see "unknown" instead of guessing.

import { useSyncExternalStore } from 'react'

const KEY = 'us_admin_secret'
const EVENT = 'us-admin-secret-change'

/** Fallback when sessionStorage is blocked (private mode, strict in-app browsers). */
let memory: string | null = null

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function readAdminSecret(): string | null {
  try {
    const value = store()?.getItem(KEY)
    if (value) return value
  } catch {
    /* fall back to memory */
  }
  return memory
}

export function writeAdminSecret(secret: string | null): void {
  memory = secret
  try {
    const s = store()
    if (s) {
      if (secret === null) s.removeItem(KEY)
      else s.setItem(KEY, secret)
    }
  } catch {
    // Storage blocked or full: the in-memory copy keeps this tab signed in.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}

const serverSnapshot = (): undefined => undefined

/** undefined while hydrating, null when signed out, else the secret. */
export function useAdminSecret(): string | null | undefined {
  return useSyncExternalStore<string | null | undefined>(subscribe, readAdminSecret, serverSnapshot)
}
