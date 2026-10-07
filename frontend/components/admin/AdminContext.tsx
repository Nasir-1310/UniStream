'use client'
// components/admin/AdminContext.tsx
//
// What every admin section needs from the shell: the signed-in admin, error
// handling, cache invalidation after mutations, navigation between sections,
// and the shared dialogs (credentials, edit user, add user). API calls need
// nothing from here: lib/api attaches the admin token itself.

import { createContext, useContext } from 'react'
import type { AdminSession, AdminUser, CredentialsResult, Overview } from '@/lib/api'

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
  /** The signed-in admin (token, username, expiry, "keep me signed in"). */
  session: AdminSession
  /** ADMIN_RESET_PASSWORD is set on the server (from GET /admin/auth/me). */
  recoveryMode: boolean
  /** Sign out of the dashboard on this device. */
  signOut: () => void
  /**
   * True when the error is a 401 that ended the admin session (the sign-in
   * screen is already on its way). Callers skip their own error display then.
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

/** The dashboard context, or null outside it (the first-sign-in setup screen). */
export function useOptionalAdmin(): AdminContextValue | null {
  return useContext(AdminContext)
}

/** Display name for a user row: name, else email, else phone, else the legacy identifier. */
export function userLabel(user: Pick<AdminUser, 'name' | 'email' | 'phone'> & { identifier?: string }): string {
  return user.name?.trim() || user.email || user.phone || user.identifier || 'this user'
}
