'use client'
// components/download/hooks.ts
//
// Small browser-state hooks for the download page. Each is an external store
// read through useSyncExternalStore, so the server render and the hydration
// pass see a neutral value and the browser value follows without a mismatch.

import { useSyncExternalStore } from 'react'

const noopSubscribe = () => () => {}

// ── Clock ─────────────────────────────────────────────────────────────────────
// Coarse on purpose: "resets in 7 h 20 min" only needs minute precision, and a
// snapshot that changes every 30 s keeps re-renders cheap. 0 = not known yet.

const CLOCK_MS = 30_000

function subscribeClock(callback: () => void): () => void {
  const id = window.setInterval(callback, CLOCK_MS)
  // A phone that slept for hours should show the right time when it wakes.
  document.addEventListener('visibilitychange', callback)
  return () => {
    window.clearInterval(id)
    document.removeEventListener('visibilitychange', callback)
  }
}

const readClock = () => Math.floor(Date.now() / CLOCK_MS) * CLOCK_MS
const readServerClock = () => 0

/** Current time in ms, refreshed every 30 s; 0 during the server render. */
export function useClock(): number {
  return useSyncExternalStore(subscribeClock, readClock, readServerClock)
}

// ── Network status ────────────────────────────────────────────────────────────

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

/** False while the browser reports no network connection. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true,
  )
}

// ── In-app browsers ───────────────────────────────────────────────────────────
// Links shared in Messenger, Facebook or Instagram open in the app's built-in
// browser, which often ignores file downloads. Most of our users arrive that
// way, so the page tells them to switch to Chrome or Safari up front.

const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|MicroMessenger|Line\/|; wv\)/i

/** True inside a social app's built-in browser or an Android WebView. */
export function useInAppBrowser(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => IN_APP_BROWSER.test(navigator.userAgent || ''),
    () => false,
  )
}
