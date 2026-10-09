'use client'
// components/admin/AdminShell.tsx
//
// Dashboard frame: top bar, section navigation (sidebar from lg, bottom tab
// bar on phones and tablets), the recovery-mode warning, the shared dialogs,
// and the AdminContext every section reads. Sections mount on first visit and
// then stay mounted (hidden) so their filters and page survive switching back
// and forth.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LayoutDashboard, LogOut, MessageSquareHeart, RefreshCw, ScrollText, Server, Settings, ShieldCheck, Users, type LucideIcon } from 'lucide-react'
import Navbar from '@/components/Navbar'
import { Alert, Spinner, useToast } from '@/components/ui'
import { adminOverview, apiErrorMessage, type AdminSession, type AdminUser } from '@/lib/api'
import { formatCompact } from '@/lib/format'
import {
  AdminContext,
  SECTION_IDS,
  type AdminContextValue,
  type CredentialsEntry,
  type NavigationIntent,
  type Revisions,
  type Scope,
  type SectionId,
} from './AdminContext'
import { AddUserModal } from './AddUserModal'
import { CredentialsModal } from './CredentialsModal'
import { isAdminSessionEnded, useAdminQuery } from './hooks'
import { FeedbackSection } from './FeedbackSection'
import { LogsSection } from './LogsSection'
import { OverviewSection } from './OverviewSection'
import { SettingsSection } from './SettingsSection'
import { SystemSection } from './SystemSection'
import { UserEditModal } from './UserEditModal'
import { UsersSection } from './UsersSection'

/** `short` is the label in the phone tab bar (five tabs at 320px). */
const NAV: { id: SectionId; label: string; short: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', short: 'Overview', icon: LayoutDashboard },
  { id: 'users', label: 'Users', short: 'Users', icon: Users },
  { id: 'logs', label: 'Download history', short: 'History', icon: ScrollText },
  { id: 'feedback', label: 'Feedback', short: 'Feedback', icon: MessageSquareHeart },
  { id: 'settings', label: 'Settings', short: 'Settings', icon: Settings },
  { id: 'system', label: 'System', short: 'System', icon: Server },
]

function sectionFromHash(hash: string): SectionId | null {
  const id = hash.replace(/^#/, '') as SectionId
  return SECTION_IDS.includes(id) ? id : null
}

/** Refresh the overview (pending count, charts) this often while the tab is visible. */
const OVERVIEW_POLL_MS = 60_000

export function AdminShell({
  session,
  recoveryMode,
  onSignOut,
}: {
  session: AdminSession
  recoveryMode: boolean
  onSignOut: () => void
}) {
  const toast = useToast()
  const [section, setSection] = useState<SectionId>(() => sectionFromHash(window.location.hash) ?? 'overview')
  const [visited, setVisited] = useState<SectionId[]>(() => [sectionFromHash(window.location.hash) ?? 'overview'])
  const [intent, setIntent] = useState<{ users: number; logs: number; value: NavigationIntent | null }>({ users: 0, logs: 0, value: null })
  const [revisions, setRevisions] = useState<Revisions>({ users: 0, logs: 0, settings: 0, system: 0 })
  const [credentials, setCredentials] = useState<CredentialsEntry[] | null>(null)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [adding, setAdding] = useState(false)

  // A 401 has already ended the session in lib/api; AdminApp shows the sign-in screen.
  const handleAuthError = isAdminSessionEnded

  const reportError = useCallback(
    (err: unknown, title = 'Something went wrong') => {
      if (isAdminSessionEnded(err)) return
      toast.error(title, { description: apiErrorMessage(err) })
    },
    [toast],
  )

  const invalidate = useCallback((...scopes: Scope[]) => {
    setRevisions(current => {
      const next = { ...current }
      for (const scope of scopes) next[scope] += 1
      return next
    })
  }, [])

  const show = useCallback((id: SectionId) => {
    setSection(id)
    setVisited(current => (current.includes(id) ? current : [...current, id]))
  }, [])

  const navigate = useCallback(
    (id: SectionId, nextIntent?: NavigationIntent) => {
      if (nextIntent) {
        setIntent(current => ({
          users: current.users + (nextIntent.section === 'users' ? 1 : 0),
          logs: current.logs + (nextIntent.section === 'logs' ? 1 : 0),
          value: nextIntent,
        }))
      }
      show(id)
      if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`)
      window.scrollTo({ top: 0 })
      // Move focus to the new section's heading for keyboard and screen-reader users.
      window.requestAnimationFrame(() => document.getElementById(`admin-h-${id}`)?.focus({ preventScroll: true }))
    },
    [show],
  )

  // Back/forward between sections. Other hashes (the skip link's #main) are ignored.
  useEffect(() => {
    const onHistory = () => {
      const id = sectionFromHash(window.location.hash)
      if (id) show(id)
    }
    window.addEventListener('popstate', onHistory)
    window.addEventListener('hashchange', onHistory)
    return () => {
      window.removeEventListener('popstate', onHistory)
      window.removeEventListener('hashchange', onHistory)
    }
  }, [show])

  const presentCredentials = useCallback(
    (entries: CredentialsEntry[], successTitle: string) => {
      const manual = entries.filter(entry => !entry.credentials.emailed)
      if (manual.length) {
        // Two approvals can finish while the dialog is open: keep every password
        // on screen (a later result for the same user replaces the earlier one).
        setCredentials(current => {
          if (!current) return entries
          const ids = new Set(entries.map(entry => entry.user.id))
          return [...current.filter(entry => !ids.has(entry.user.id)), ...entries]
        })
        return
      }
      const emailed = entries.filter(entry => entry.credentials.emailed)
      toast.success(successTitle, {
        description:
          emailed.length === 1
            ? `Password emailed to ${emailed[0].user.email ?? 'the user'}.`
            : emailed.length > 1
            ? `${emailed.length} passwords emailed.`
            : undefined,
      })
    },
    [toast],
  )

  // ── Overview: counts for the nav badges, settings and system status ──────────
  const overviewQuery = useAdminQuery(
    `overview|${revisions.users}|${revisions.logs}|${revisions.settings}|${revisions.system}`,
    adminOverview,
  )
  const { reload: reloadOverview } = overviewQuery
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') reloadOverview()
    }, OVERVIEW_POLL_MS)
    return () => window.clearInterval(timer)
  }, [reloadOverview])

  const overview = overviewQuery.data ?? null
  const pending = overview?.users.pending ?? 0

  const refreshAll = () => invalidate('users', 'logs', 'settings', 'system')
  const refreshing = overviewQuery.loading && overview !== null

  const context = useMemo<AdminContextValue>(
    () => ({
      session,
      recoveryMode,
      signOut: onSignOut,
      handleAuthError,
      reportError,
      revisions,
      invalidate,
      overview,
      navigate,
      presentCredentials,
      editUser: setEditing,
      addUser: () => setAdding(true),
    }),
    [session, recoveryMode, onSignOut, handleAuthError, reportError, revisions, invalidate, overview, navigate, presentCredentials],
  )

  const sections: Record<SectionId, ReactNode> = {
    overview: <OverviewSection query={overviewQuery} />,
    users: (
      <UsersSection
        key={`users-${intent.users}`}
        intent={intent.value?.section === 'users' ? intent.value : undefined}
      />
    ),
    logs: <LogsSection key={`logs-${intent.logs}`} intent={intent.value?.section === 'logs' ? intent.value : undefined} />,
    feedback: <FeedbackSection />,
    settings: <SettingsSection />,
    system: <SystemSection />,
  }

  return (
    <AdminContext.Provider value={context}>
      <div className="min-h-svh flex flex-col bg-[#0d0f1a]">
        <Navbar
          showAuth={false}
          homeHref="/"
          rightSlot={
            <>
              <span
                className="hidden sm:inline-flex max-w-[11rem] items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-200"
                title={`Signed in as ${session.username}`}
              >
                <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 text-indigo-300" aria-hidden="true" />
                <span className="sr-only">Signed in as </span>
                <span className="truncate">{session.username}</span>
              </span>
              <button
                type="button"
                onClick={refreshAll}
                disabled={refreshing}
                className="btn-outline"
                aria-label="Refresh all data"
                title="Refresh all data"
              >
                {refreshing ? <Spinner size="sm" label={null} /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
                <span className="hidden md:inline">Refresh</span>
              </button>
              <button type="button" onClick={onSignOut} className="btn-outline" aria-label="Sign out" title="Sign out">
                <LogOut className="w-4 h-4" aria-hidden="true" />
                <span className="hidden md:inline">Sign out</span>
              </button>
            </>
          }
        />

        <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 lg:grid lg:grid-cols-[208px_minmax(0,1fr)] lg:gap-8">
          {/* Sidebar (lg+) */}
          <aside className="hidden lg:block">
            <nav aria-label="Admin sections" className="sticky top-14 pt-8 pb-6">
              <ul className="space-y-1">
                {NAV.map(item => {
                  const active = item.id === section
                  return (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        onClick={event => {
                          event.preventDefault()
                          navigate(item.id)
                        }}
                        aria-current={active ? 'page' : undefined}
                        className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
                          active ? 'bg-indigo-500/15 text-white' : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                        }`}
                      >
                        <item.icon className={`w-4 h-4 ${active ? 'text-indigo-300' : ''}`} aria-hidden="true" />
                        <span className="flex-1">{item.label}</span>
                        {item.id === 'users' && pending > 0 && (
                          <span className="min-w-5 h-5 px-1.5 rounded-full bg-amber-500/20 text-amber-200 text-[11px] font-semibold flex items-center justify-center tabular-nums">
                            {formatCompact(pending)}
                            <span className="sr-only"> pending</span>
                          </span>
                        )}
                      </a>
                    </li>
                  )
                })}
              </ul>
              {overview && <SidebarStatus overview={overview} />}
            </nav>
          </aside>

          <main id="main" className="min-w-0 pt-5 sm:pt-8 pb-28 lg:pb-12">
            {recoveryMode && <RecoveryBanner onOpenSettings={() => navigate('settings')} showLink={section !== 'settings'} />}
            {SECTION_IDS.filter(id => visited.includes(id)).map(id => (
              <div key={id} hidden={id !== section}>
                {sections[id]}
              </div>
            ))}
          </main>
        </div>

        {/* Bottom tab bar (below lg) */}
        <nav
          aria-label="Admin sections"
          className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-[#0d0f1a]/95 backdrop-blur-md
                     pb-[env(safe-area-inset-bottom)]"
        >
          <ul className="grid grid-cols-6 max-w-2xl mx-auto">
            {NAV.map(item => {
              const active = item.id === section
              return (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    onClick={event => {
                      event.preventDefault()
                      navigate(item.id)
                    }}
                    aria-current={active ? 'page' : undefined}
                    className={`relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                      active ? 'text-white' : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {active && <span className="absolute top-0 inset-x-4 h-0.5 rounded-full bg-indigo-400" aria-hidden="true" />}
                    <span className="relative">
                      <item.icon className={`w-5 h-5 ${active ? 'text-indigo-300' : ''}`} aria-hidden="true" />
                      {item.id === 'users' && pending > 0 && (
                        <span className="absolute -top-1.5 -right-2.5 min-w-4 h-4 px-1 rounded-full bg-amber-500 text-[10px] font-bold text-black flex items-center justify-center tabular-nums">
                          {pending > 99 ? '99+' : pending}
                          <span className="sr-only"> pending</span>
                        </span>
                      )}
                    </span>
                    {item.short}
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>
      </div>

      <UserEditModal user={editing} onClose={() => setEditing(null)} />
      <AddUserModal open={adding} onClose={() => setAdding(false)} />
      <CredentialsModal open={credentials !== null} entries={credentials ?? []} onClose={() => setCredentials(null)} />
    </AdminContext.Provider>
  )
}

function SidebarStatus({ overview }: { overview: NonNullable<AdminContextValue['overview']> }) {
  const { system } = overview
  const rows: [string, boolean, string][] = [
    ['Database', system.schema_ready && system.persistent, system.storage === 'supabase' ? (system.schema_ready ? 'Supabase' : 'Upgrade needed') : 'SQLite (local)'],
    ['Email', system.email.configured, system.email.configured ? system.email.provider ?? 'On' : 'Not set up'],
    ['Sign-ins', system.auth_secret_configured, system.auth_secret_configured ? 'Secure' : 'Set AUTH_SECRET'],
  ]
  return (
    <div className="mt-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 mb-2">Status</p>
      <ul className="space-y-1.5">
        {rows.map(([label, ok, value]) => (
          <li key={label} className="flex items-center gap-2 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`} aria-hidden="true" />
            <span className="text-slate-500">{label}</span>
            <span className="ml-auto text-slate-300 capitalize truncate">{value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** ADMIN_RESET_PASSWORD is still set: the setup password signs in too until it is removed. */
function RecoveryBanner({ onOpenSettings, showLink }: { onOpenSettings: () => void; showLink: boolean }) {
  return (
    <Alert
      tone="warning"
      title="Password recovery is still on"
      className="mb-5"
      action={
        showLink ? (
          <button type="button" onClick={onOpenSettings} className="btn-outline btn-sm">
            Check your admin account
          </button>
        ) : undefined
      }
    >
      While <code className="text-slate-100">ADMIN_RESET_PASSWORD</code> is set on the server, the setup password from your
      server settings also signs in to this dashboard. Now that you have your own password, remove{' '}
      <code className="text-slate-100">ADMIN_RESET_PASSWORD</code> and redeploy.
    </Alert>
  )
}
