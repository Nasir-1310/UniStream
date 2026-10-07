'use client'
// components/admin/OverviewSection.tsx
//
// First screen after sign-in: what needs attention (setup problems, pending
// access requests), then usage at a glance.

import { useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  Database,
  Download,
  Hourglass,
  PieChart,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react'
import { Alert, EmptyState } from '@/components/ui'
import { adminListUsers, type Overview } from '@/lib/api'
import { formatLimit, formatNumber, formatPhone, formatRelative, formatTime, initials, pluralize } from '@/lib/format'
import { useAdmin, userLabel } from './AdminContext'
import { DownloadsChart, PlatformSplit } from './DownloadsChart'
import { useAdminQuery, type AdminQuery } from './hooks'
import { MigrationPanel } from './MigrationPanel'
import { Card, QueryError, SectionHeader, SkeletonRows, StatCard } from './parts'
import { UserRowActions, useUserActions } from './useUserActions'

export function OverviewSection({ query }: { query: AdminQuery<Overview> }) {
  const { addUser, navigate } = useAdmin()
  const overview = query.data

  const header = (
    <SectionHeader
      id="overview"
      title="Overview"
      description={
        overview
          ? `Access requests, members and downloads at a glance · updated ${formatTime(query.updatedAt)}`
          : 'Access requests, members and downloads at a glance'
      }
      actions={
        <button type="button" onClick={addUser} className="btn-primary btn-sm">
          <UserPlus className="w-4 h-4" aria-hidden="true" />
          Add user
        </button>
      }
    />
  )

  if (!overview) {
    return (
      <section aria-labelledby="admin-h-overview">
        {header}
        {query.error ? (
          <QueryError message={query.error} onRetry={query.reload} />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="shimmer h-32 rounded-2xl" />
              ))}
            </div>
            <div className="shimmer h-72 rounded-2xl" />
          </div>
        )}
      </section>
    )
  }

  const { users, downloads, settings } = overview

  return (
    <section aria-labelledby="admin-h-overview" className="space-y-4 sm:space-y-5">
      {header}

      {query.error && <QueryError title="Could not refresh the overview" message={query.error} onRetry={query.reload} />}

      <SystemAlerts overview={overview} />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="Pending requests"
          value={formatNumber(users.pending)}
          icon={Hourglass}
          tone={users.pending > 0 ? 'warning' : 'neutral'}
          hint={users.pending > 0 ? 'Waiting for you' : 'All caught up'}
        />
        <StatCard
          label="Active members"
          value={formatNumber(users.approved)}
          icon={UserCheck}
          tone="success"
          hint={`${formatNumber(users.total)} total · ${formatNumber(users.blocked)} blocked`}
        />
        <StatCard
          label="Downloads today"
          value={formatNumber(downloads.today)}
          icon={Download}
          tone="brand"
          hint={`Default limit ${formatLimit(settings.default_daily_limit)}`}
        />
        <StatCard
          label="Last 30 days"
          value={formatNumber(downloads.last_30_days)}
          icon={TrendingUp}
          tone="info"
          hint={`${formatNumber(downloads.last_7_days)} in the last 7 days`}
        />
      </div>

      {users.pending > 0 && <PendingRequests total={users.pending} />}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-5">
        <Card title="Downloads per day" description="Last 14 days, completed downloads" icon={BarChart3} className="xl:col-span-2">
          <DownloadsChart daily={downloads.daily} />
        </Card>
        <Card title="By platform" description="Last 30 days" icon={PieChart}>
          <PlatformSplit platforms={downloads.platforms} />
          <button
            type="button"
            onClick={() => navigate('logs')}
            className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-indigo-300 hover:text-indigo-200 min-h-10"
          >
            Open download logs
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </Card>
      </div>

      {users.total === 0 && (
        <Card>
          <EmptyState
            icon={Users}
            title="No users yet"
            description="Share the website link: students request access from the home page, and their requests appear here for approval. You can also add people yourself."
            action={
              <button type="button" onClick={addUser} className="btn-primary btn-sm">
                <UserPlus className="w-4 h-4" aria-hidden="true" />
                Add the first user
              </button>
            }
          />
        </Card>
      )}
    </section>
  )
}

// ── Setup / health warnings ───────────────────────────────────────────────────

function SystemAlerts({ overview }: { overview: Overview }) {
  const { navigate } = useAdmin()
  const [showSql, setShowSql] = useState(false)
  const { system } = overview
  const goSettings = (
    <button type="button" onClick={() => navigate('settings')} className="btn-outline btn-sm">
      Open settings
    </button>
  )

  return (
    <>
      {!system.schema_ready && (
        <Alert
          tone="danger"
          title="Database upgrade required"
          action={
            <button type="button" onClick={() => setShowSql(v => !v)} aria-expanded={showSql} className="btn-outline btn-sm">
              {showSql ? 'Hide migration SQL' : 'Show migration SQL'}
            </button>
          }
        >
          The Supabase database is missing the v2 tables and columns, so sign-up, sign-in and downloads fail until you run
          the migration script once.
        </Alert>
      )}
      {!system.schema_ready && showSql && (
        <Card title="Run the database migration" icon={Database}>
          <MigrationPanel />
        </Card>
      )}
      {!system.persistent && (
        <Alert tone="warning" title="Data is stored on the server’s disk (SQLite)">
          Accounts and logs can be lost when the server restarts or redeploys. Set <code className="text-slate-100">SUPABASE_URL</code>{' '}
          and <code className="text-slate-100">SUPABASE_SERVICE_KEY</code> before launch.
        </Alert>
      )}
      {!system.email.configured && (
        <Alert tone="warning" title="Email isn’t set up" action={goSettings}>
          {system.email.issue ? `${system.email.issue} ` : ''}
          Approvals still work, but you’ll have to share each password yourself, and “Forgot password” emails can’t be sent.
        </Alert>
      )}
      {!system.auth_secret_configured && (
        <Alert tone="warning" title="AUTH_SECRET is not set" action={goSettings}>
          User sessions are signed with a fallback key. Set <code className="text-slate-100">AUTH_SECRET</code> to a random value of
          at least 32 characters on the server so sessions stay valid when other secrets change.
        </Alert>
      )}
    </>
  )
}

// ── Pending access requests ───────────────────────────────────────────────────

const PREVIEW_SIZE = 5

function PendingRequests({ total }: { total: number }) {
  const { revisions, navigate, editUser } = useAdmin()
  const actions = useUserActions()
  // Oldest first: first come, first served.
  const query = useAdminQuery(`pending-preview|${revisions.users}|${revisions.settings}`, secret =>
    adminListUsers(secret, { status: 'pending', page_size: PREVIEW_SIZE, sort: 'created_at', order: 'asc' }),
  )
  const items = query.data?.items ?? []

  return (
    <Card
      title={`${pluralize(total, 'access request')} waiting`}
      description="Approving creates a temporary password and emails it to the user."
      icon={Hourglass}
      bodyClassName="p-0"
      actions={
        <button
          type="button"
          onClick={() => navigate('users', { section: 'users', status: 'pending' })}
          className="btn-outline btn-sm"
        >
          Review all
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
      }
    >
      {query.error && !items.length ? (
        <div className="p-4">
          <QueryError message={query.error} onRetry={query.reload} />
        </div>
      ) : !query.data ? (
        <div className="p-4">
          <SkeletonRows count={Math.min(total, 3)} className="h-14" />
        </div>
      ) : (
        <ul className={`divide-y divide-white/[0.06] transition-opacity ${query.stale ? 'opacity-60' : ''}`}>
          {items.map(user => (
            <li key={user.id} className="flex flex-col gap-3 px-4 sm:px-5 py-3.5 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => editUser(user)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left rounded-lg -m-1 p-1 hover:bg-white/[0.03]"
              >
                <span className="w-9 h-9 flex-shrink-0 rounded-full bg-amber-500/15 border border-amber-500/25 text-amber-200 text-xs font-semibold flex items-center justify-center">
                  {initials(user.name || user.email)}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-white truncate">{userLabel(user)}</span>
                  <span className="block text-xs text-slate-400 truncate">
                    {[user.name ? user.email : null, user.phone ? formatPhone(user.phone) : null].filter(Boolean).join(' · ') ||
                      'No phone number'}
                  </span>
                  <span className="block text-[11px] text-slate-500 truncate">
                    {user.note ? `${user.note} · ` : ''}requested {formatRelative(user.created_at)}
                  </span>
                </span>
              </button>
              <div className="sm:w-auto">
                <UserRowActions user={user} actions={actions} fullWidth={false} />
              </div>
            </li>
          ))}
          {total > items.length && items.length > 0 && (
            <li className="px-4 sm:px-5 py-2.5 text-xs text-slate-500">
              and {pluralize(total - items.length, 'more request')} —{' '}
              <button
                type="button"
                onClick={() => navigate('users', { section: 'users', status: 'pending' })}
                className="text-indigo-300 hover:text-indigo-200 font-medium"
              >
                review all
              </button>
            </li>
          )}
        </ul>
      )}
    </Card>
  )
}
