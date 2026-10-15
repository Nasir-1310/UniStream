'use client'
// lib/pwa.ts
//
// "Install as an app" support.
//
// Chrome, Edge and Samsung Internet fire `beforeinstallprompt` when the site
// can be installed. The inline script in app/layout.tsx keeps that event as
// window.__installPrompt (it can fire before React has loaded), and
// promptInstall() later opens the browser's own install dialog with it.
// Safari on iPhone/iPad has no such event: there the UI shows the
// Share → Add to Home Screen steps instead.

import { useSyncExternalStore } from 'react'
import { IN_APP_BROWSER } from '@/components/download/hooks'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

declare global {
  interface Window {
    __installPrompt?: BeforeInstallPromptEvent | null
  }
}

export type InstallPlatform = 'ios' | 'android' | 'desktop'

export interface InstallState {
  /** False on the server and during hydration: render no install UI yet. */
  ready: boolean
  /** Running as the installed app (its own window, no address bar). */
  installed: boolean
  /** The browser's install dialog can be opened right away. */
  canPrompt: boolean
  platform: InstallPlatform
  /** Facebook/Instagram/Messenger's built-in browser: nothing can be installed there. */
  inAppBrowser: boolean
}

const SERVER_STATE: InstallState = {
  ready: false,
  installed: false,
  canPrompt: false,
  platform: 'android',
  inAppBrowser: false,
}

const listeners = new Set<() => void>()
let state: InstallState = SERVER_STATE
let started = false
let installedThisVisit = false

function detectPlatform(): InstallPlatform {
  const ua = navigator.userAgent
  // iPadOS reports itself as a Mac; touch support gives it away.
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'desktop'
}

function runningInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function computeState(): InstallState {
  return {
    ready: true,
    installed: installedThisVisit || runningInstalled(),
    canPrompt: Boolean(window.__installPrompt),
    platform: detectPlatform(),
    inAppBrowser: IN_APP_BROWSER.test(navigator.userAgent || ''),
  }
}

function emit(): void {
  state = computeState()
  listeners.forEach(listener => listener())
}

function start(): void {
  if (started) return
  started = true
  window.addEventListener('beforeinstallprompt', event => {
    // Our own buttons offer the install; skip Chrome's mini-infobar.
    event.preventDefault()
    window.__installPrompt = event as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    window.__installPrompt = null
    installedThisVisit = true
    emit()
  })
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', emit)
  state = computeState()
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

/**
 * Open the browser's install dialog. 'unavailable' when the browser offers no
 * dialog (iPhone, Firefox, already shown): show the manual steps instead.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = window.__installPrompt
  if (!event) return 'unavailable'
  // The event works once; Chrome fires a fresh one later if the user declines.
  window.__installPrompt = null
  emit()
  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    return outcome
  } catch {
    return 'unavailable'
  }
}

/** Register the service worker (offline page for the installed app). */
export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined)
}
