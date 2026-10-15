'use client'
// lib/pwa.ts
//
// "Install as an app" support.
//
// Chrome, Edge and Samsung Internet fire `beforeinstallprompt` when the site
// can be installed (in Chrome only once the visitor has tapped the site and
// spent about 30 seconds on it, counted across visits). The inline script in
// app/layout.tsx keeps that event as window.__installPrompt, since it can
// fire before React has loaded, and promptInstall() later opens the
// browser's own install dialog with it. Safari on iPhone/iPad has no such
// event: installing there is Share → Add to Home Screen.
//
// Chrome never fires the event while the app is installed, and desktop
// Chrome can't always say so (getInstalledRelatedApps), so this device
// remembers an install (us_app_installed: set when installed or opened as
// the app, cleared as soon as Chrome offers the install again) and counts
// time on the site (us_seen_ms) to know how long Chrome may still hold
// the offer back. The install dialog never waits longer than that.

import { useSyncExternalStore } from 'react'
import { IN_APP_BROWSER } from '@/components/download/hooks'
import { getToken } from '@/lib/auth'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

declare global {
  interface Window {
    __installPrompt?: BeforeInstallPromptEvent | null
  }
}

export type InstallPlatform = 'android' | 'ios' | 'desktop'
export type InstallBrowser = 'chromium' | 'samsung' | 'safari' | 'firefox' | 'other'

export interface InstallState {
  /** False on the server and during hydration: render no install UI yet. */
  ready: boolean
  /** Hide the install offers: running as the app, just installed, or installed earlier. */
  installed: boolean
  /** Running as the installed app (its own window, no address bar). */
  standalone: boolean
  /** Installed during this visit. */
  justInstalled: boolean
  /** Installed earlier on this device (Chrome reports it via getInstalledRelatedApps). */
  alreadyInstalled: boolean
  /** The browser's install dialog can be opened right now. */
  canPrompt: boolean
  /** This browser offers the install dialog (Chrome, Edge, Samsung...), possibly not yet. */
  supportsPrompt: boolean
  /** The visitor closed the browser's install dialog without installing (this visit). */
  dismissed: boolean
  platform: InstallPlatform
  browser: InstallBrowser
  /** Facebook/Instagram/Messenger's built-in browser: nothing can be installed there. */
  inAppBrowser: boolean
}

const SERVER_STATE: InstallState = {
  ready: false,
  installed: false,
  standalone: false,
  justInstalled: false,
  alreadyInstalled: false,
  canPrompt: false,
  supportsPrompt: false,
  dismissed: false,
  platform: 'android',
  browser: 'other',
  inAppBrowser: false,
}

const INSTALLED_KEY = 'us_app_installed'
const SEEN_KEY = 'us_seen_ms'
const SEEN_STEP_MS = 5000
/** Chrome holds the install offer back until ~30 s were spent on the site. */
const CHROME_ENGAGEMENT_MS = 30_000

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Storage blocked (private mode): the dialog just waits its full time.
  }
}

const listeners = new Set<() => void>()
let state: InstallState = SERVER_STATE
let started = false
let justInstalled = false
let alreadyInstalled = false
let dismissed = false

function detectPlatform(ua: string): InstallPlatform {
  // iPadOS reports itself as a Mac; touch support gives it away.
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'desktop'
}

function detectBrowser(ua: string): InstallBrowser {
  if (/SamsungBrowser/i.test(ua)) return 'samsung'
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox'
  if (/CriOS|EdgiOS|OPiOS|Chrome|Chromium|Edg\//i.test(ua)) return 'chromium'
  if (/Safari/i.test(ua)) return 'safari'
  return 'other'
}

function runningStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function computeState(): InstallState {
  const ua = navigator.userAgent || ''
  const standalone = runningStandalone()
  const canPrompt = Boolean(window.__installPrompt)
  // Remembered install, unless Chrome is offering the install (so it's gone).
  const known = alreadyInstalled || (!canPrompt && storageGet(INSTALLED_KEY) === '1')
  return {
    ready: true,
    installed: standalone || justInstalled || known,
    standalone,
    justInstalled,
    alreadyInstalled: known,
    canPrompt,
    supportsPrompt: 'onbeforeinstallprompt' in window,
    dismissed,
    platform: detectPlatform(ua),
    browser: detectBrowser(ua),
    inAppBrowser: IN_APP_BROWSER.test(ua),
  }
}

function emit(): void {
  state = computeState()
  listeners.forEach(listener => listener())
}

/** Chrome on Android can tell whether this site is already installed (see related_applications in the manifest). */
async function checkAlreadyInstalled(): Promise<void> {
  const nav = navigator as Navigator & {
    getInstalledRelatedApps?: () => Promise<{ platform: string; url?: string }[]>
  }
  if (!nav.getInstalledRelatedApps) return
  try {
    const apps = await nav.getInstalledRelatedApps()
    if (apps.some(app => app.platform === 'webapp')) {
      alreadyInstalled = true
      emit()
    }
  } catch {
    // Not supported for this kind of app here: nothing to report.
  }
}

function start(): void {
  if (started) return
  started = true
  window.addEventListener('beforeinstallprompt', event => {
    // Our own buttons offer the install; skip Chrome's mini-infobar.
    event.preventDefault()
    window.__installPrompt = event as BeforeInstallPromptEvent
    // Chrome only offers this when the app is not installed.
    storageSet(INSTALLED_KEY, null)
    emit()
  })
  window.addEventListener('appinstalled', () => {
    window.__installPrompt = null
    justInstalled = true
    storageSet(INSTALLED_KEY, '1')
    emit()
  })
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', emit)
  if (window.__installPrompt) storageSet(INSTALLED_KEY, null)
  if (runningStandalone()) storageSet(INSTALLED_KEY, '1')

  // Count visible time on the site, the way Chrome does before offering the install.
  const counter = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return
    const seen = Number(storageGet(SEEN_KEY)) || 0
    if (seen >= 2 * CHROME_ENGAGEMENT_MS) {
      window.clearInterval(counter)
      return
    }
    storageSet(SEEN_KEY, String(seen + SEEN_STEP_MS))
  }, SEEN_STEP_MS)

  state = computeState()
  void checkAlreadyInstalled()
}

/**
 * How long the install dialog should wait for Chrome's offer before saying
 * it isn't coming (usually because the app is already installed): a moment
 * for anyone who has used the site before, otherwise until Chrome's ~30 s of
 * time on the site are up.
 */
export function installOfferWaitMs(): number {
  const seen = Number(storageGet(SEEN_KEY)) || 0
  if (seen >= CHROME_ENGAGEMENT_MS || getToken()) return 2500
  return Math.min(40_000, CHROME_ENGAGEMENT_MS - seen + 5000)
}

function subscribe(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): InstallState {
  start()
  return state
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_STATE)
}

/** Open the browser's install dialog; 'unavailable' when there is none right now. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = window.__installPrompt
  if (!event) return 'unavailable'
  // The event works once; Chrome fires a fresh one on a later page load.
  window.__installPrompt = null
  emit()
  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === 'accepted') justInstalled = true
    else dismissed = true
    emit()
    return outcome
  } catch {
    return 'unavailable'
  }
}

/** Android: open this page in Chrome (out of Facebook's browser, Firefox, ...). */
export function chromeIntentUrl(): string {
  const { host, pathname, search, href } = window.location
  return `intent://${host}${pathname}${search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`
}

/** Register the service worker (offline page for the installed app). */
export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined)
}
