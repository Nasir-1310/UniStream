'use client'
// components/admin/AdminContext.tsx
//
// What every admin section needs from the shell: the secret for API calls,
// error handling that sends a rejected secret back to the sign-in screen,
// cache invalidation after mutations, navigation between sections, and the
// shared dialogs (credentials, edit user, add user).

import { createContext, useContext } from 'react'
import type { AdminUser, CredentialsResult, Overview } from '@/lib/api'

export type SectionId = 'overview' | 'users' | 'logs' | 'settings' | 'system'

export const SECTION_IDS: readonly SectionId[] = ['overview', 'users', 'logs', 'settings', 'system']

/** Data groups a mutation can make stale; each query key includes the ones it reads. */
export type Scope = 'users' | 'logs' | 'settings' | 'system'

export type Revisions = Record<Scope, number>

/** Where to land when switching sections from elsewhere (e.g. "Review pending"). */
export type NavigationIntent =
  | { section: 'users'; status?: 'pending' | 'approved' | 'blocked'; q?: string }
  | { section: 'logs'; userId?: string; userLabel?: string; q?: string }

/** One issued password and how it was delivered. */
export interface CredentialsEntry {
  user: Pick<AdminUser, 'id' | 'name' | 'email' | 'phone'>
  credentials: CredentialsResult
}

export interface AdminContextValue {
  secret: string
  /** Leave the dashboard; `expired` explains on the sign-in screen that the secret was rejected. */
  signOut: (options?: { expired?: boolean }) => void
  /**
   * Returns true (and signs out) when the error is a 401 — the secret was
   * changed on the server. Callers skip their own error display then.
   */
  handleAuthError: (err: unknown) => boolean
  /** Toast an API error (title + detail). Handles 401 like handleAuthError. */
  reportError: (err: unknown, title?: string) => void
  revisions: Revisions
  /** Mark data as stale so every mounted query that reads it refetches. */
  invalidate: (...scopes: Scope[]) => void
  /** Latest dashboard overview (counts, settings, system status), or null while loading. */
  overview: Overview | null
  navigate: (section: SectionId, intent?: NavigationIntent) => void
  /**
   * Tell the admin how issued passwords were delivered: a toast when every
   * one was emailed, otherwise the dialog with passwords to copy.
   */
  presentCredentials: (entries: CredentialsEntry[], successTitle: string) => void
  editUser: (user: AdminUser) => void
  addUser: () => void
}

export const AdminContext = createContext<AdminContextValue | null>(null)

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin() must be used inside the admin dashboard.')
  return ctx
}

/** Display name for a user row: name, else email, else phone, else the legacy identifier. */
export function userLabel(user: Pick<AdminUser, 'name' | 'email' | 'phone'> & { identifier?: string }): string {
  return user.name?.trim() || user.email || user.phone || user.identifier || 'this user'
}
