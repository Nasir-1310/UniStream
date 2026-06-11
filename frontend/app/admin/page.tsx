'use client'
// frontend/app/admin/page.tsx
import { useState, useEffect, useCallback } from 'react'
import {
  adminListUsers, adminAddUser, adminUpdateStatus,
  adminDeleteUser, adminGetLogs
} from '@/lib/api'
import {
  Shield, Plus, Trash2, CheckCircle2, XCircle,
  Clock, Loader2, AlertCircle, Users, Activity,
  LogIn, Eye, EyeOff, RefreshCw, Search, ExternalLink,
  ChevronDown, UserCheck, UserX, Download
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

// ── Reusable stat card ────────────────────────────────────────────────────────
function StatCard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="admin-card p-4 flex flex-col gap-1">
      <span className={`text-3xl font-bold font-display ${color}`}>{value}</span>
      <span className="text-xs text-gray-500 font-medium">{label}</span>
    </div>
  )
}

// ── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: 'approved' | 'pending' | 'blocked' }) {
  const sc = STATUS_CONFIG[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${sc.badgeBg} ${sc.textColor}`}>
      {sc.icon}
      {sc.label}
    </span>
  )
}

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

  const load = useCallback(async () => {
    if (!secret) return
    setLoading(true)
    setError('')
    try {
      if (tab === 'users') {
        const data = await adminListUsers(secret, statusFilter || undefined)
        setUsers(data.users)
      } else {
        const data = await adminGetLogs(secret, 100)
        setLogs(data.logs)
      }
    } catch (e: any) {
      if (e?.response?.status === 401) {
        setLoggedIn(false)
        setSecret('')
        setError('Invalid secret key. Please log in again.')
      } else {
        setError('Failed to load data. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }, [secret, tab, statusFilter])

  useEffect(() => { if (loggedIn) load() }, [loggedIn, load])

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
      setAddSuccess(`"${newId.trim()}" has been approved.`)
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

  const filteredUsers = users.filter(u =>
    u.identifier.toLowerCase().includes(search.toLowerCase()) ||
    (u.note || '').toLowerCase().includes(search.toLowerCase())
  )

  // ── Login screen ──────────────────────────────────────────────────────────
  if (!loggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-[#0a0d14]">
        {/* Ambient glow */}
        <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full bg-brand-500/6 blur-[100px]" />
        </div>

        <div className="relative w-full max-w-sm">
          {/* Logo mark */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 bg-brand-500 rounded-2xl flex items-center justify-center shadow-lg shadow-brand-500/30 mb-4">
              <Shield className="w-7 h-7 text-white" strokeWidth={2} />
            </div>
            <h1 className="text-xl font-bold text-white font-display">Admin Panel</h1>
            <p className="text-sm text-gray-500 mt-1">UniStream Saver · Restricted Access</p>
          </div>

          <div className="admin-card p-7">
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
                  Admin Secret Key
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={secretInput}
                    onChange={e => setSecretInput(e.target.value)}
                    placeholder="Enter your secret key"
                    className="input-field pr-11"
                    autoFocus
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors p-1"
                    tabIndex={-1}
                    aria-label={showSecret ? 'Hide key' : 'Show key'}
                  >
                    {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {authError && (
                  <p className="text-xs text-red-400 mt-2 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" /> {authError}
                  </p>
                )}
              </div>

              <button
                type="submit"
                className="btn-primary w-full flex items-center justify-center gap-2"
                disabled={!secretInput.trim()}
              >
                <LogIn className="w-4 h-4" />
                Sign in to Admin
              </button>
            </form>
          </div>

          <p className="text-center text-xs text-gray-700 mt-5">
            This area is restricted to authorised university staff only.
          </p>
        </div>
      </div>
    )
  }

  // ── Dashboard ────────────────────────────────────────────────────────────
  const stats = {
    total: users.length,
    approved: users.filter(u => u.status === 'approved').length,
    pending: users.filter(u => u.status === 'pending').length,
    blocked: users.filter(u => u.status === 'blocked').length,
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0d14]">

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 border-b border-white/5 bg-[#0a0d14]/90 backdrop-blur-xl px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" strokeWidth={2} />
            </div>
            <div>
              <span className="font-bold text-white text-sm font-display">Admin Panel</span>
              <span className="hidden sm:inline text-gray-600 text-xs ml-2">UniStream Saver</span>
            </div>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5 border border-transparent hover:border-white/8"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 space-y-6">

        {/* ── Stats ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard value={stats.total} label="Total users" color="text-white" />
          <StatCard value={stats.approved} label="Approved" color="text-emerald-400" />
          <StatCard value={stats.pending} label="Pending" color="text-amber-400" />
          <StatCard value={stats.blocked} label="Blocked" color="text-red-400" />
        </div>

        {/* ── Add User ── */}
        <div className="admin-card p-5 sm:p-6">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-8 h-8 bg-brand-500/15 rounded-lg flex items-center justify-center">
              <UserCheck className="w-4 h-4 text-brand-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white font-display">Approve new user</h2>
              <p className="text-xs text-gray-600 mt-0.5">Grant access by Gmail or phone number</p>
            </div>
          </div>

          <form onSubmit={handleAddUser} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2.5">
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
                placeholder="Note, e.g. CSE B24"
                className="input-field text-sm sm:w-44"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={adding || !newId.trim()}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                {adding
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Plus className="w-3.5 h-3.5" />
                }
                {adding ? 'Approving…' : 'Approve user'}
              </button>
              {addSuccess && (
                <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {addSuccess}
                </p>
              )}
            </div>
          </form>

          {error && (
            <div className="mt-3 flex items-start gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg px-3 py-2.5">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* ── Tab bar ── */}
        <div className="flex gap-1 bg-white/3 border border-white/6 rounded-xl p-1">
          {([
            ['users', 'Users', <Users className="w-3.5 h-3.5" />],
            ['logs', 'Download logs', <Activity className="w-3.5 h-3.5" />],
          ] as const).map(([t, label, icon]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold transition-all duration-200 ${
                tab === t
                  ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/30'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              {icon}
              <span>{label}</span>
              {t === 'users' && users.length > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  tab === t ? 'bg-white/20 text-white' : 'bg-white/8 text-gray-500'
                }`}>
                  {users.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Users tab ── */}
        {tab === 'users' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by identifier or note…"
                  className="input-field pl-9 text-sm"
                />
              </div>
              <div className="relative sm:w-44">
                <select
                  value={statusFilter}
                  onChange={e => { setStatusFilter(e.target.value); load() }}
                  className="input-field text-sm appearance-none pr-8 cursor-pointer"
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
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-[72px] rounded-xl shimmer" />
                ))}
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="admin-card flex flex-col items-center justify-center py-16 text-center">
                <Users className="w-8 h-8 text-gray-700 mb-3" />
                <p className="text-sm font-medium text-gray-500">No users found</p>
                <p className="text-xs text-gray-700 mt-1">
                  {search || statusFilter ? 'Try adjusting your filters.' : 'Add the first approved user above.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredUsers.map(user => {
                  const sc = STATUS_CONFIG[user.status]
                  return (
                    <div
                      key={user.id}
                      className="admin-card px-4 py-3.5 flex items-center gap-3 hover:border-white/10 transition-colors"
                    >
                      {/* Status badge */}
                      <StatusBadge status={user.status} />

                      {/* Identity */}
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate leading-snug">
                          {user.identifier}
                        </p>
                        <div className="flex items-center gap-2.5 mt-0.5">
                          {user.note && (
                            <span className="text-xs text-gray-500 truncate">{user.note}</span>
                          )}
                          <span className="text-xs text-gray-700">
                            {new Date(user.created_at).toLocaleDateString('en-GB', {
                              day: 'numeric', month: 'short', year: 'numeric',
                            })}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {user.status !== 'approved' && (
                          <ActionButton
                            onClick={() => handleStatus(user.identifier, 'approved')}
                            label="Approve"
                            className="text-emerald-500 hover:bg-emerald-500/15"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </ActionButton>
                        )}
                        {user.status !== 'blocked' && (
                          <ActionButton
                            onClick={() => handleStatus(user.identifier, 'blocked')}
                            label="Block"
                            className="text-amber-500 hover:bg-amber-500/15"
                          >
                            <UserX className="w-4 h-4" />
                          </ActionButton>
                        )}
                        <ActionButton
                          onClick={() => handleDelete(user.identifier)}
                          label="Delete"
                          className="text-red-600 hover:text-red-400 hover:bg-red-500/15"
                        >
                          <Trash2 className="w-4 h-4" />
                        </ActionButton>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Count footer */}
            {!loading && filteredUsers.length > 0 && (
              <p className="text-xs text-gray-700 text-center pt-1">
                Showing {filteredUsers.length} of {users.length} users
              </p>
            )}
          </div>
        )}

        {/* ── Logs tab ── */}
        {tab === 'logs' && (
          <div className="space-y-2">
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="h-[72px] rounded-xl shimmer" />
                ))}
              </div>
            ) : logs.length === 0 ? (
              <div className="admin-card flex flex-col items-center justify-center py-16 text-center">
                <Download className="w-8 h-8 text-gray-700 mb-3" />
                <p className="text-sm font-medium text-gray-500">No downloads yet</p>
                <p className="text-xs text-gray-700 mt-1">Activity will appear here once users start downloading.</p>
              </div>
            ) : (
              logs.map(log => (
                <div key={log.id} className="admin-card px-4 py-3.5 hover:border-white/10 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate leading-snug">
                        {log.title || 'Untitled video'}
                      </p>
                      <p className="text-gray-500 text-xs truncate mt-0.5">{log.identifier}</p>
                      <div className="flex items-center gap-2.5 mt-1.5">
                        {log.platform && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-500/10 text-brand-400 border border-brand-500/20">
                            {log.platform}
                          </span>
                        )}
                        <span className="text-xs text-gray-700">
                          {new Date(log.created_at).toLocaleString('en-GB', {
                            day: 'numeric', month: 'short', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>
                    <a
                      href={log.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 p-2 rounded-lg text-gray-600 hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                      title="Open video"
                      aria-label="Open original video"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 px-4 py-4 text-center text-xs text-gray-700">
        UniStream Saver Admin · Authorised access only
      </footer>
    </div>
  )
}

// ── Tiny helper: icon action button ──────────────────────────────────────────
function ActionButton({
  onClick,
  label,
  className,
  children,
}: {
  onClick: () => void
  label: string
  className: string
  children: React.ReactNode
}) {
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