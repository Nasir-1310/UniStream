'use client'
// components/admin/UsersSection.tsx
//
// Every account: server-side search, status filter, sort and pagination
// (fine for thousands of users), a table from md up and cards on phones,
// row selection with bulk approve / block / delete, and per-user actions.

import { useState } from 'react'
import { Ban, CircleCheck, Clock3, Infinity as InfinityIcon, Search, Trash2, UserPlus, Users, X } from 'lucide-react'
import { Badge, EmptyState, Pagination, StatusBadge } from '@/components/ui'
import { adminListUsers, type AdminUser, type UserSort, type UserStatus } from '@/lib/api'
import { EMPTY, formatDate, formatNumber, formatPhone, formatRelative, initials, pluralize } from '@/lib/format'
import { useAdmin, userLabel, type NavigationIntent } from './AdminContext'
import { useAdminQuery, useDebouncedValue } from './hooks'
import { Checkbox, QueryError, SectionHeader, SkeletonRows } from './parts'
import { UserRowActions, useUserActions, type UserActions } from './useUserActions'

type StatusFilter = 'all' | UserStatus

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'blocked', label: 'Blocked' },
]

const SORTS: Record<string, { label: string; sort: UserSort; order: 'asc' | 'desc' }> = {
  newest: { label: 'Newest first', sort: 'created_at', order: 'desc' },
  oldest: { label: 'Oldest first', sort: 'created_at', order: 'asc' },
  name: { label: 'Name (A–Z)', sort: 'name', order: 'asc' },
  downloaded: { label: 'Last download', sort: 'last_download_at', order: 'desc' },
  signedIn: { label: 'Last sign-in', sort: 'last_login_at', order: 'desc' },
  downloads: { label: 'Most downloads', sort: 'total_downloads', order: 'desc' },
}

const PAGE_SIZES = [10, 25, 50, 100]

const AVATAR_TONES: Record<UserStatus, string> = {
  approved: 'bg-indigo-500/15 border-indigo-500/25 text-indigo-200',
  pending: 'bg-amber-500/15 border-amber-500/25 text-amber-200',
  blocked: 'bg-red-500/10 border-red-500/25 text-red-300',
}

type UsersIntent = Extract<NavigationIntent, { section: 'users' }>

export function UsersSection({ intent }: { intent?: UsersIntent }) {
  const { revisions, overview, addUser } = useAdmin()
  const [status, setStatus] = useState<StatusFilter>(intent?.status ?? 'all')
  const [search, setSearch] = useState(intent?.q ?? '')
  // Pending requests read best oldest-first (first come, first served).
  const [sortKey, setSortKey] = useState(intent?.status === 'pending' ? 'oldest' : 'newest')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const q = useDebouncedValue(search.trim(), 350)
  const sort = SORTS[sortKey]

  const query = useAdminQuery(
    `users|${status}|${q}|${page}|${pageSize}|${sortKey}|${revisions.users}|${revisions.settings}`,
    () =>
      adminListUsers({
        status: status === 'all' ? undefined : status,
        q: q || undefined,
        page,
        page_size: pageSize,
        sort: sort.sort,
        order: sort.order,
      }),
  )
  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0

  // Selection belongs to one page of one filter; changing either clears it.
  const scope = `${status}|${q}|${page}|${pageSize}|${sortKey}`
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope: '', ids: [] })
  const visibleIds = items.map(user => user.id)
  const selectedIds = selection.scope === scope ? selection.ids.filter(id => visibleIds.includes(id)) : []
  const selectedUsers = items.filter(user => selectedIds.includes(user.id))
  const allSelected = items.length > 0 && selectedIds.length === items.length

  const toggle = (id: string, on: boolean) =>
    setSelection({ scope, ids: on ? [...selectedIds, id] : selectedIds.filter(other => other !== id) })
  const toggleAll = (on: boolean) => setSelection({ scope, ids: on ? visibleIds : [] })
  const clearSelection = () => setSelection({ scope, ids: [] })

  const actions = useUserActions({
    // Step back a page when the last rows of a later page were deleted.
    onRemoved: ids => {
      if (page > 1 && ids.length >= items.length) setPage(current => Math.max(1, current - 1))
    },
  })

  const runBulk = async (action: Parameters<UserActions['bulk']>[1]) => {
    const done = await actions.bulk(selectedUsers, action)
    if (done) clearSelection()
  }

  const counts = overview?.users
  const countFor = (id: StatusFilter) => (counts ? (id === 'all' ? counts.total : counts[id]) : null)
  const filtered = status !== 'all' || q !== ''
  const bulkBusy = Boolean(actions.busy.bulk)

  return (
    <section aria-labelledby="admin-h-users">
      <SectionHeader
        id="users"
        title="Users"
        description="Approve access requests, send passwords and set daily limits."
        actions={
          <button type="button" onClick={addUser} className="btn-primary btn-sm">
            <UserPlus className="w-4 h-4" aria-hidden="true" />
            Add user
          </button>
        }
      />

      {/* Filters */}
      <div className="space-y-3 mb-4">
        <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto no-scrollbar">
          <div role="group" aria-label="Filter by status" className="inline-flex gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
            {STATUS_TABS.map(tab => {
              const active = status === tab.id
              const count = countFor(tab.id)
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setStatus(tab.id)
                    setPage(1)
                  }}
                  className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors ${
                    active ? 'bg-indigo-500/20 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                  }`}
                >
                  {tab.label}
                  {count !== null && (
                    <span
                      className={`min-w-5 rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
                        tab.id === 'pending' && count > 0
                          ? 'bg-amber-500/20 text-amber-200'
                          : active
                          ? 'bg-white/10 text-slate-200'
                          : 'bg-white/[0.06] text-slate-400'
                      }`}
                    >
                      {formatNumber(count)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <label htmlFor="users-search" className="sr-only">
              Search users
            </label>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
            <input
              id="users-search"
              type="search"
              value={search}
              onChange={e => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search name, email, phone or note"
              autoComplete="off"
              spellCheck={false}
              className="input-field pl-10 pr-10 py-2.5"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  setPage(1)
                }}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 btn-icon"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="sm:w-52">
            <label htmlFor="users-sort" className="sr-only">
              Sort users
            </label>
            <select
              id="users-sort"
              value={sortKey}
              onChange={e => {
                setSortKey(e.target.value)
                setPage(1)
              }}
              className="input-field py-2.5"
            >
              {Object.entries(SORTS).map(([key, option]) => (
                <option key={key} value={key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {query.error && (
        <div className="mb-4">
          <QueryError message={query.error} onRetry={query.reload} title="Could not load users" />
        </div>
      )}

      <div className="surface-card overflow-hidden">
        {!query.data ? (
          query.error ? null : (
            <div className="p-4">
              <SkeletonRows count={6} className="h-14" />
            </div>
          )
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={Search}
              title="No users match"
              description={q ? `Nothing found for “${q}”${status !== 'all' ? ` among ${status} users` : ''}.` : `There are no ${status} users.`}
              action={
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setStatus('all')
                    setPage(1)
                  }}
                  className="btn-outline"
                >
                  Clear filters
                </button>
              }
            />
          ) : total > 0 ? (
            <EmptyState
              icon={Users}
              title="This page is empty"
              action={
                <button type="button" onClick={() => setPage(1)} className="btn-outline">
                  Go to the first page
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No users yet"
              description="Access requests from the home page appear here. You can also add people yourself."
              action={
                <button type="button" onClick={addUser} className="btn-primary btn-sm">
                  <UserPlus className="w-4 h-4" aria-hidden="true" />
                  Add user
                </button>
              }
            />
          )
        ) : (
          <div className={`transition-opacity ${query.stale ? 'opacity-60' : ''}`} aria-busy={query.loading}>
            <UsersTable
              items={items}
              selectedIds={selectedIds}
              allSelected={allSelected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              actions={actions}
            />
            <UsersCards items={items} selectedIds={selectedIds} allSelected={allSelected} onToggle={toggle} onToggleAll={toggleAll} actions={actions} />
          </div>
        )}

        {query.data && total > 0 && (
          <div className="border-t border-white/[0.06] px-4 sm:px-5 py-3">
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={next => {
                setPage(next)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              pageSizeOptions={PAGE_SIZES}
              onPageSizeChange={size => {
                setPageSize(size)
                setPage(1)
              }}
              disabled={query.loading}
              itemLabel="users"
            />
          </div>
        )}
      </div>

      {/* Bulk actions: sticks to the bottom of the screen (above the tab bar on phones) while rows are selected. */}
      {selectedIds.length > 0 && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-4 z-20 mt-3">
          <div
            role="region"
            aria-label="Bulk actions"
            className="flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-500/30 bg-[#151829]/95 backdrop-blur-md px-3 py-2.5 shadow-2xl shadow-black/50"
          >
            <p className="mr-auto pl-1 text-[13px] text-slate-200" aria-live="polite">
              <span className="font-semibold text-white">{selectedIds.length}</span> selected
            </p>
            {selectedUsers.some(user => user.status !== 'approved') && (
              <button type="button" disabled={bulkBusy} onClick={() => runBulk('approve')} className="btn-outline">
                <CircleCheck className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                Approve
              </button>
            )}
            {selectedUsers.some(user => user.status !== 'blocked') && (
              <button type="button" disabled={bulkBusy} onClick={() => runBulk('block')} className="btn-outline">
                <Ban className="w-4 h-4 text-amber-400" aria-hidden="true" />
                Block
              </button>
            )}
            {selectedUsers.some(user => user.status === 'approved') && (
              <button type="button" disabled={bulkBusy} onClick={() => runBulk('pending')} className="btn-outline max-sm:hidden">
                <Clock3 className="w-4 h-4" aria-hidden="true" />
                Move to pending
              </button>
            )}
            <button type="button" disabled={bulkBusy} onClick={() => runBulk('delete')} className="btn-outline text-red-300 hover:text-red-200">
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              Delete
            </button>
            <button type="button" onClick={clearSelection} className="btn-icon" aria-label="Clear selection" title="Clear selection">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// ── Shared cell content ───────────────────────────────────────────────────────

interface ListProps {
  items: AdminUser[]
  selectedIds: string[]
  allSelected: boolean
  onToggle: (id: string, on: boolean) => void
  onToggleAll: (on: boolean) => void
  actions: UserActions
}

function Avatar({ user }: { user: AdminUser }) {
  return (
    <span
      className={`w-9 h-9 flex-shrink-0 rounded-full border text-xs font-semibold flex items-center justify-center ${AVATAR_TONES[user.status]}`}
      aria-hidden="true"
    >
      {initials(user.name || user.email || user.identifier)}
    </span>
  )
}

function UserIdentity({ user }: { user: AdminUser }) {
  const { editUser } = useAdmin()
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar user={user} />
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => editUser(user)}
          className="block max-w-full truncate text-left text-sm font-medium text-white hover:text-indigo-200 hover:underline underline-offset-2"
          title="View & edit"
        >
          {userLabel(user)}
        </button>
        {user.name && (user.email || !user.phone) && (
          <p className="truncate text-xs text-slate-400" title={user.email ?? undefined}>
            {user.email ?? user.identifier ?? EMPTY}
          </p>
        )}
        {(user.phone || user.note) && (
          <p className="truncate text-[11px] text-slate-500" title={user.note ?? undefined}>
            {[user.phone ? formatPhone(user.phone) : null, user.note].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </div>
  )
}

function StatusCell({ user }: { user: AdminUser }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusBadge status={user.status} />
      {user.status === 'approved' && !user.has_password && (
        <Badge tone="warning" title="They can’t sign in until you send a password">
          No password
        </Badge>
      )}
      {user.status === 'approved' && user.has_password && user.temp_password && (
        <Badge title="Still using the temporary password from the admin">Temporary password</Badge>
      )}
    </div>
  )
}

function UsageCell({ user }: { user: AdminUser }) {
  const unlimited = user.effective_limit === null
  const full = !unlimited && user.effective_limit !== null && user.used_today >= user.effective_limit
  return (
    <div className="text-[13px] tabular-nums">
      <span className={full ? 'text-amber-300 font-semibold' : 'text-slate-200'}>{formatNumber(user.used_today)}</span>
      <span className="text-slate-500">
        {' / '}
        {unlimited ? (
          <>
            <InfinityIcon className="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" />
            <span className="sr-only">unlimited</span>
          </>
        ) : (
          formatNumber(user.effective_limit)
        )}
      </span>
      {user.daily_limit !== null && (
        <span className="block text-[11px] text-slate-500">{user.daily_limit < 0 ? 'Unlimited' : 'Custom limit'}</span>
      )}
    </div>
  )
}

function lastActive(user: AdminUser): string {
  if (user.last_download_at) return `Downloaded ${formatRelative(user.last_download_at)}`
  if (user.last_login_at) return `Signed in ${formatRelative(user.last_login_at)}`
  return user.status === 'pending' ? `Requested ${formatRelative(user.created_at)}` : 'No activity yet'
}

// ── Table (md and up) ─────────────────────────────────────────────────────────

function UsersTable({ items, selectedIds, allSelected, onToggle, onToggleAll, actions }: ListProps) {
  return (
    <table className="hidden md:table w-full table-fixed text-left">
      <caption className="sr-only">Users</caption>
      <thead>
        <tr className="border-b border-white/[0.06] text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          <th scope="col" className="w-12 py-3 pl-5 pr-1">
            <Checkbox
              checked={allSelected}
              indeterminate={selectedIds.length > 0 && !allSelected}
              onChange={onToggleAll}
              label="Select all users on this page"
            />
          </th>
          <th scope="col" className="py-3 px-3">User</th>
          <th scope="col" className="w-[150px] py-3 px-3">Status</th>
          <th scope="col" className="w-[96px] py-3 px-3">Today</th>
          <th scope="col" className="hidden xl:table-cell w-[84px] py-3 px-3 text-right">Total</th>
          <th scope="col" className="hidden xl:table-cell w-[170px] py-3 px-3">Activity</th>
          <th scope="col" className="hidden 2xl:table-cell w-[120px] py-3 px-3">Joined</th>
          <th scope="col" className="w-[168px] py-3 pl-3 pr-5">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/[0.05]">
        {items.map(user => {
          const selected = selectedIds.includes(user.id)
          return (
            <tr key={user.id} className={`align-middle transition-colors ${selected ? 'bg-indigo-500/[0.06]' : 'hover:bg-white/[0.02]'}`}>
              <td className="py-3 pl-5 pr-1">
                <Checkbox checked={selected} onChange={on => onToggle(user.id, on)} label={`Select ${userLabel(user)}`} />
              </td>
              <td className="py-3 px-3 min-w-0">
                <UserIdentity user={user} />
              </td>
              <td className="py-3 px-3">
                <StatusCell user={user} />
              </td>
              <td className="py-3 px-3">
                <UsageCell user={user} />
              </td>
              <td className="hidden xl:table-cell py-3 px-3 text-right text-[13px] tabular-nums text-slate-300">
                {formatNumber(user.total_downloads)}
              </td>
              <td className="hidden xl:table-cell py-3 px-3 text-xs text-slate-400">{lastActive(user)}</td>
              <td className="hidden 2xl:table-cell py-3 px-3 text-xs text-slate-400">{formatDate(user.created_at, { time: false })}</td>
              <td className="py-3 pl-3 pr-5">
                <UserRowActions user={user} actions={actions} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── Cards (phones) ────────────────────────────────────────────────────────────

function UsersCards({ items, selectedIds, allSelected, onToggle, onToggleAll, actions }: ListProps) {
  return (
    <div className="md:hidden">
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-2.5">
        <Checkbox
          checked={allSelected}
          indeterminate={selectedIds.length > 0 && !allSelected}
          onChange={onToggleAll}
          label="Select all users on this page"
        />
        <span className="text-xs text-slate-500">Select all on this page</span>
      </div>
      <ul className="divide-y divide-white/[0.06]">
        {items.map(user => {
          const selected = selectedIds.includes(user.id)
          return (
            <li key={user.id} className={`px-4 py-4 ${selected ? 'bg-indigo-500/[0.06]' : ''}`}>
              <div className="flex items-start gap-3">
                <div className="pt-2.5">
                  <Checkbox checked={selected} onChange={on => onToggle(user.id, on)} label={`Select ${userLabel(user)}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <UserIdentity user={user} />
                  <div className="mt-2.5">
                    <StatusCell user={user} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <dt className="text-slate-500">Today</dt>
                      <dd className="mt-0.5">
                        <UsageCell user={user} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">All-time</dt>
                      <dd className="mt-0.5 text-[13px] text-slate-200 tabular-nums">{pluralize(user.total_downloads, 'download')}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="sr-only">Activity</dt>
                      <dd className="text-slate-400">{lastActive(user)}</dd>
                    </div>
                  </dl>
                  <div className="mt-3">
                    <UserRowActions user={user} actions={actions} fullWidth />
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
