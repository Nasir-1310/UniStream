'use client'
// frontend/app/admin/page.tsx
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  adminListUsers, adminAddUser, adminUpdateStatus,
  adminDeleteUser, adminGetLogs
} from '@/lib/api'
import {
  Shield, Plus, Trash2, CheckCircle2, XCircle,
  Clock, Loader2, AlertCircle, Users, Activity,
  LogIn, Eye, EyeOff, RefreshCw, Search, ExternalLink,
  ChevronDown, UserCheck, UserX, Download,
  ChevronLeft, ChevronRight,
} from 'lucide-react'

interface User {
  id: string
  identifier: string
  status: 'approved' | 'pending' | 'blocked'
  name?: string
  note?: string
  created_at: string
}

interface Log {
  id: string
  identifier: string
  url: string
  title: string
  platform: string
  created_at: string
}

const PAGE_SIZE = 20

const STATUS_CONFIG = {
  approved: {
    label: 'Approved',
    textColor: 'text-emerald-400',
    badgeBg: 'bg-emerald-500/10 border-emerald-500/25',
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  pending: {
    label: 'Pending',
    textColor: 'text-amber-400',
    badgeBg: 'bg-amber-500/10 border-amber-500/25',
    icon: <Clock className="w-3 h-3" />,
  },
  blocked: {
    label: 'Blocked',
    textColor: 'text-red-400',
    badgeBg: 'bg-red-500/10 border-red-500/25',
    icon: <XCircle className="w-3 h-3" />,
  },
}

// ── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  value, label, color, sublabel,
}: { value: number; label: string; color: string; sublabel?: string }) {
  return (
    <div className="admin-card p-4 sm:p-5 flex flex-col gap-1.5">
      <span className={`text-2xl sm:text-3xl font-bold font-display tracking-tight ${color}`}>
        {value}
      </span>
      <span className="text-xs font-semibold text-gray-400">{label}</span>
      {sublabel && <span className="text-[11px] text-gray-700">{sublabel}</span>}
    </div>
  )
}

// ── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: 'approved' | 'pending' | 'blocked' }) {
  const sc = STATUS_CONFIG[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${sc.badgeBg} ${sc.textColor} whitespace-nowrap`}
    >
      {sc.icon}
      <span className="hidden xs:inline">{sc.label}</span>
    </span>
  )
}

// ── Pagination ────────────────────────────────────────────────────────────────
function Pagination({
  page, totalPages, total, pageSize,
  onPrev, onNext, onPage,
}: {
  page: number; totalPages: number; total: number; pageSize: number;
  onPrev: () => void; onNext: () => void; onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  // Generate page numbers with ellipsis
  const pages: (number | '...')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('...')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i)
    }
    if (page < totalPages - 2) pages.push('...')
    pages.push(totalPages)
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
      <p className="text-xs text-gray-600 order-2 sm:order-1">
        Showing <span className="text-gray-400 font-medium">{from}–{to}</span> of{' '}
        <span className="text-gray-400 font-medium">{total}</span>
      </p>

      <div className="flex items-center gap-1 order-1 sm:order-2">
        <PaginationBtn onClick={onPrev} disabled={page === 1} aria="Previous page">
          <ChevronLeft className="w-3.5 h-3.5" />
        </PaginationBtn>

        {pages.map((p, i) =>
          p === '...'
            ? (
              <span key={`ellipsis-${i}`} className="w-8 h-8 flex items-center justify-center text-xs text-gray-600">
                …
              </span>
            )
            : (
              <button
                key={p}
                onClick={() => onPage(p as number)}
                className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all ${
                  page === p
                    ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/30'
                    : 'text-gray-500 hover:text-gray-200 hover:bg-white/6'
                }`}
              >
                {p}
              </button>
            )
        )}

        <PaginationBtn onClick={onNext} disabled={page === totalPages} aria="Next page">
          <ChevronRight className="w-3.5 h-3.5" />
        </PaginationBtn>
      </div>
    </div>
  )
}

function PaginationBtn({
  onClick, disabled, children, aria,
}: { onClick: () => void; disabled: boolean; children: React.ReactNode; aria: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={aria}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-white/6 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  )
}

// ── Action Button ─────────────────────────────────────────────────────────────
function ActionButton({
  onClick, label, className, children,
}: { onClick: () => void; label: string; className: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`p-2 rounded-lg transition-colors ${className}`}
    >
      {children}
    </button>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────
function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="admin-card flex flex-col items-center justify-center py-20 text-center">
      <div className="w-12 h-12 rounded-2xl bg-white/3 border border-white/6 flex items-center justify-center mb-4 text-gray-700">
        {icon}
      </div>
      <p className="text-sm font-semibold text-gray-400">{title}</p>
      <p className="text-xs text-gray-700 mt-1 max-w-xs">{body}</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [secret, setSecret] = useState('')
  const [secretInput, setSecretInput] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [authError, setAuthError] = useState('')

  const [tab, setTab] = useState<'users' | 'logs'>('users')
  const [users, setUsers] = useState<User[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [newId, setNewId] = useState('')
  const [newNote, setNewNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [addSuccess, setAddSuccess] = useState('')

  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  // Pagination state (separate per tab)
  const [userPage, setUserPage] = useState(1)
  const [logPage, setLogPage] = useState(1)

  const load = useCallback(async () => {
    if (!secret) return
    setLoading(true)
    setError('')
    try {
      if (tab === 'users') {
        const data = await adminListUsers(secret, statusFilter || undefined)
        setUsers(data.users)
        setUserPage(1)
      } else {
        const data = await adminGetLogs(secret, 500)
        setLogs(data.logs)
        setLogPage(1)
      }
    } catch (e: any) {
      if (e?.response?.status === 401) {
        setLoggedIn(false)
        setSecret('')
        setError('Session expired — please sign in again.')
      } else {
        setError('Failed to load data. Try again.')
      }
    } finally {
      setLoading(false)
    }
  }, [secret, tab, statusFilter])

  useEffect(() => { if (loggedIn) load() }, [loggedIn, load])

  // Reset page on search/filter change
  useEffect(() => { setUserPage(1) }, [search, statusFilter])

  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!secretInput.trim()) return
    setAuthError('')
    setSecret(secretInput.trim())
    setLoggedIn(true)
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault()
    if (!newId.trim()) return
    setAdding(true)
    setAddSuccess('')
    setError('')
    try {
      await adminAddUser(secret, newId.trim(), newNote.trim() || undefined)
      setAddSuccess(`"${newId.trim()}" approved.`)
      setNewId('')
      setNewNote('')
      load()
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not add user.')
    } finally {
      setAdding(false)
    }
  }

  async function handleStatus(identifier: string, status: string) {
    try {
      await adminUpdateStatus(secret, identifier, status)
      load()
    } catch {
      setError('Could not update status.')
    }
  }

  async function handleDelete(identifier: string) {
    if (!confirm(`Permanently delete "${identifier}"? This cannot be undone.`)) return
    try {
      await adminDeleteUser(secret, identifier)
      load()
    } catch {
      setError('Could not delete user.')
    }
  }

  // Filtered + paginated users
  const filteredUsers = useMemo(() =>
    users.filter(u =>
      u.identifier.toLowerCase().includes(search.toLowerCase()) ||
      (u.note || '').toLowerCase().includes(search.toLowerCase())
    ),
    [users, search]
  )
  const userTotalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE))
  const pagedUsers = filteredUsers.slice((userPage - 1) * PAGE_SIZE, userPage * PAGE_SIZE)

  // Paginated logs
  const logTotalPages = Math.max(1, Math.ceil(logs.length / PAGE_SIZE))
  const pagedLogs = logs.slice((logPage - 1) * PAGE_SIZE, logPage * PAGE_SIZE)

  const stats = {
    total: users.length,
    approved: users.filter(u => u.status === 'approved').length,
    pending: users.filter(u => u.status === 'pending').length,
    blocked: users.filter(u => u.status === 'blocked').length,
  }

  // ── Login screen ───────────────────────────────────────────────────────────
  if (!loggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-[#0a0d14]">
        <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full bg-brand-500/6 blur-[100px]" />
        </div>

        <div className="relative w-full max-w-sm fade-up">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 bg-brand-500 rounded-2xl flex items-center justify-center shadow-lg shadow-brand-500/30 mb-4">
              <Shield className="w-7 h-7 text-white" strokeWidth={2} />
            </div>
            <h1 className="text-xl font-bold text-white font-display">Admin Panel</h1>
            <p className="text-sm text-gray-600 mt-1">UniStream Saver · Restricted Access</p>
          </div>

          <div className="admin-card p-7">
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-2 uppercase tracking-widest">
                  Secret Key
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={secretInput}
                    onChange={e => setSecretInput(e.target.value)}
                    placeholder="Enter your secret key"
                    className={`input-field pr-11 ${authError ? 'input-error' : ''}`}
                    autoFocus
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300 transition-colors p-1"
                    tabIndex={-1}
                    aria-label={showSecret ? 'Hide key' : 'Show key'}
                  >
                    {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {authError && (
                  <p className="text-xs text-red-400 mt-2 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {authError}
                  </p>
                )}
              </div>

              <button
                type="submit"
                className="btn-primary w-full flex items-center justify-center gap-2 py-3"
                disabled={!secretInput.trim()}
              >
                <LogIn className="w-4 h-4" />
                Sign in
              </button>
            </form>
          </div>

          <p className="text-center text-xs text-gray-700 mt-5">
            Authorised university staff only.
          </p>
        </div>
      </div>
    )
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-[#0a0d14]">

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-white/5 bg-[#0a0d14]/90 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <Shield className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-sm font-display">Admin</span>
              <span className="hidden sm:block w-px h-3.5 bg-white/10" />
              <span className="hidden sm:inline text-gray-600 text-xs">UniStream Saver</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/8 border border-emerald-500/15">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-[11px] font-semibold text-emerald-400 hidden sm:inline">Live</span>
            </div>

            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-200 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5 border border-transparent hover:border-white/8"
              aria-label="Refresh data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 space-y-5">

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard value={stats.total} label="Total users" color="text-white" />
          <StatCard value={stats.approved} label="Approved" color="text-emerald-400" />
          <StatCard value={stats.pending} label="Pending" color="text-amber-400" />
          <StatCard value={stats.blocked} label="Blocked" color="text-red-400" />
        </div>

        {/* Add user */}
        <div className="admin-card p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-8 h-8 bg-brand-500/12 rounded-lg flex items-center justify-center flex-shrink-0">
              <UserCheck className="w-4 h-4 text-brand-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white font-display leading-tight">Approve new user</h2>
              <p className="text-xs text-gray-600 mt-0.5">Grant access by Gmail address or phone number</p>
            </div>
          </div>

          <form onSubmit={handleAddUser}>
            <div className="flex flex-col sm:flex-row gap-2.5 mb-3">
              <input
                type="text"
                value={newId}
                onChange={e => setNewId(e.target.value)}
                placeholder="Gmail address or phone number"
                className="input-field text-sm flex-1"
              />
              <input
                type="text"
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="Note — e.g. CSE B24"
                className="input-field text-sm sm:w-48"
              />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="submit"
                disabled={adding || !newId.trim()}
                className="btn-primary flex items-center gap-2 text-sm py-2.5 px-4"
              >
                {adding
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Plus className="w-3.5 h-3.5" />
                }
                {adding ? 'Approving…' : 'Approve'}
              </button>
              {addSuccess && (
                <p className="text-xs text-emerald-400 flex items-center gap-1.5 fade-up">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {addSuccess}
                </p>
              )}
            </div>
          </form>

          {error && (
            <div className="mt-4 flex items-start gap-2.5 bg-red-500/8 border border-red-500/18 text-red-400 text-xs rounded-xl px-3.5 py-3">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white/3 border border-white/6 rounded-xl p-1">
          {([
            ['users', 'Users', <Users className="w-3.5 h-3.5" />, users.length > 0 ? users.length : null],
            ['logs', 'Activity', <Activity className="w-3.5 h-3.5" />, logs.length > 0 ? logs.length : null],
          ] as const).map(([t, label, icon, count]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-[10px] text-xs font-semibold transition-all duration-150 ${
                tab === t
                  ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/25'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              {icon}
              <span>{label}</span>
              {count !== null && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  tab === t ? 'bg-white/20 text-white' : 'bg-white/8 text-gray-500'
                }`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Users tab ─────────────────────────────────────────────────────── */}
        {tab === 'users' && (
          <div className="space-y-3">
            {/* Filters row */}
            <div className="flex flex-col xs:flex-row gap-2.5">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search identifier or note…"
                  className="input-field pl-9 text-sm"
                />
              </div>
              <div className="relative xs:w-44">
                <select
                  value={statusFilter}
                  onChange={e => { setStatusFilter(e.target.value); load() }}
                  className="input-field text-sm appearance-none pr-9 cursor-pointer"
                >
                  <option value="">All statuses</option>
                  <option value="approved">Approved</option>
                  <option value="pending">Pending</option>
                  <option value="blocked">Blocked</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
              </div>
            </div>

            {/* User list */}
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-[68px] rounded-xl shimmer" />
                ))}
              </div>
            ) : filteredUsers.length === 0 ? (
              <EmptyState
                icon={<Users className="w-5 h-5" />}
                title="No users found"
                body={search || statusFilter ? 'Try adjusting your search or filter.' : 'Approve the first user using the form above.'}
              />
            ) : (
              <>
                {/* Column header — desktop only */}
                <div className="hidden sm:grid grid-cols-[140px_1fr_auto] gap-4 px-4 pb-1">
                  <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider">Status</span>
                  <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider">User</span>
                  <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider">Actions</span>
                </div>

                <div className="space-y-1.5">
                  {pagedUsers.map(user => (
                    <div
                      key={user.id}
                      className="admin-card px-4 py-3.5 flex items-center gap-3 hover:border-white/10 transition-colors group"
                    >
                      {/* Status */}
                      <div className="flex-shrink-0 w-[100px] sm:w-[140px]">
                        <StatusBadge status={user.status} />
                      </div>

                      {/* Identity */}
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">
                          {user.identifier}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {user.note && (
                            <span className="text-xs text-gray-600 truncate max-w-[140px]">{user.note}</span>
                          )}
                          <span className="text-xs text-gray-700">
                            {new Date(user.created_at).toLocaleDateString('en-GB', {
                              day: 'numeric', month: 'short', year: 'numeric',
                            })}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                        {user.status !== 'approved' && (
                          <ActionButton
                            onClick={() => handleStatus(user.identifier, 'approved')}
                            label="Approve"
                            className="text-emerald-500 hover:bg-emerald-500/12"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </ActionButton>
                        )}
                        {user.status !== 'blocked' && (
                          <ActionButton
                            onClick={() => handleStatus(user.identifier, 'blocked')}
                            label="Block user"
                            className="text-amber-500 hover:bg-amber-500/12"
                          >
                            <UserX className="w-4 h-4" />
                          </ActionButton>
                        )}
                        <ActionButton
                          onClick={() => handleDelete(user.identifier)}
                          label="Delete user"
                          className="text-gray-600 hover:text-red-400 hover:bg-red-500/12"
                        >
                          <Trash2 className="w-4 h-4" />
                        </ActionButton>
                      </div>
                    </div>
                  ))}
                </div>

                <Pagination
                  page={userPage}
                  totalPages={userTotalPages}
                  total={filteredUsers.length}
                  pageSize={PAGE_SIZE}
                  onPrev={() => setUserPage(p => Math.max(1, p - 1))}
                  onNext={() => setUserPage(p => Math.min(userTotalPages, p + 1))}
                  onPage={setUserPage}
                />
              </>
            )}
          </div>
        )}

        {/* ── Logs tab ───────────────────────────────────────────────────────── */}
        {tab === 'logs' && (
          <div className="space-y-3">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-[80px] rounded-xl shimmer" />
                ))}
              </div>
            ) : logs.length === 0 ? (
              <EmptyState
                icon={<Download className="w-5 h-5" />}
                title="No downloads yet"
                body="Activity will appear here once users start downloading."
              />
            ) : (
              <>
                {/* Column header — desktop only */}
                <div className="hidden sm:grid grid-cols-[1fr_160px_36px] gap-4 px-4 pb-1">
                  <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider">Video</span>
                  <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider">User · Time</span>
                  <span />
                </div>

                <div className="space-y-1.5">
                  {pagedLogs.map(log => (
                    <div
                      key={log.id}
                      className="admin-card px-4 py-3.5 flex items-center gap-3 hover:border-white/10 transition-colors group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {log.platform && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-brand-500/10 text-brand-400 border border-brand-500/20 flex-shrink-0">
                              {log.platform}
                            </span>
                          )}
                          <p className="text-white text-sm font-medium truncate">
                            {log.title || 'Untitled video'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2.5 mt-1">
                          <p className="text-gray-600 text-xs truncate">{log.identifier}</p>
                          <span className="text-gray-800 text-xs flex-shrink-0">
                            {new Date(log.created_at).toLocaleString('en-GB', {
                              day: 'numeric', month: 'short',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>

                      <a
                        href={log.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-gray-700 hover:text-brand-400 hover:bg-brand-500/10 transition-colors opacity-60 group-hover:opacity-100"
                        title="Open video"
                        aria-label="Open original video"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  ))}
                </div>

                <Pagination
                  page={logPage}
                  totalPages={logTotalPages}
                  total={logs.length}
                  pageSize={PAGE_SIZE}
                  onPrev={() => setLogPage(p => Math.max(1, p - 1))}
                  onNext={() => setLogPage(p => Math.min(logTotalPages, p + 1))}
                  onPage={setLogPage}
                />
              </>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 px-4 py-4 text-center">
        <p className="text-xs text-gray-700">UniStream Saver Admin · Authorised access only</p>
      </footer>
    </div>
  )
}