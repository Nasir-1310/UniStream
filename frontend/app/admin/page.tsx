'use client'
// frontend/app/admin/page.tsx
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  adminListUsers, adminAddUser, adminUpdateStatus,
  adminDeleteUser, adminGetLogs
} from '@/lib/api'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import {
  Shield, Plus, Trash2, CheckCircle2, XCircle,
  Clock, Loader2, AlertCircle, Users, Activity,
  LogIn, Eye, EyeOff, RefreshCw, Search, ExternalLink,
  ChevronDown, UserCheck, Download,
  ChevronLeft, ChevronRight, UserX,
} from 'lucide-react'

/* ─── Types ─────────────────────────────────────────────────────────────── */
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
    badgeBg: 'bg-emerald-500/10 border border-emerald-500/25',
    dotColor: 'bg-emerald-400',
  },
  pending: {
    label: 'Pending',
    textColor: 'text-amber-400',
    badgeBg: 'bg-amber-500/10 border border-amber-500/25',
    dotColor: 'bg-amber-400',
  },
  blocked: {
    label: 'Revoked',
    textColor: 'text-red-400',
    badgeBg: 'bg-red-500/10 border border-red-500/25',
    dotColor: 'bg-red-400',
  },
}

/* ─── Stat Card ──────────────────────────────────────────────────────────── */
function StatCard({
  value, label, sublabel, icon, glowClass, trend,
}: {
  value: number | string
  label: string
  sublabel?: string
  icon: React.ReactNode
  glowClass: string   // e.g. "bg-blue-500"
  trend?: string
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#10141f] border border-white/[0.07] p-5 flex flex-col gap-3 hover:border-white/[0.12] transition-colors">
      <div className={`pointer-events-none absolute -top-8 -right-8 w-28 h-28 rounded-full blur-2xl opacity-[0.18] ${glowClass}`} />
      <div className="flex items-start justify-between relative">
        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/8 flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        {trend && (
          <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full whitespace-nowrap">
            {trend}
          </span>
        )}
      </div>
      <div className="relative">
        <p className="text-3xl font-bold text-white tracking-tight">{value}</p>
        <p className="text-xs font-semibold text-gray-500 mt-0.5">{label}</p>
        {sublabel && <p className="text-[11px] text-gray-700 mt-1">{sublabel}</p>}
      </div>
    </div>
  )
}

/* ─── Status Badge ───────────────────────────────────────────────────────── */
function StatusBadge({ status }: { status: 'approved' | 'pending' | 'blocked' }) {
  const sc = STATUS_CONFIG[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${sc.badgeBg} ${sc.textColor} whitespace-nowrap`}>
      <span className={`w-1.5 h-1.5 rounded-full ${sc.dotColor}`} />
      {sc.label}
    </span>
  )
}

/* ─── Pagination ─────────────────────────────────────────────────────────── */
function Pagination({
  page, totalPages, total, pageSize, onPrev, onNext, onPage,
}: {
  page: number; totalPages: number; total: number; pageSize: number
  onPrev: () => void; onNext: () => void; onPage: (p: number) => void
}) {
  if (totalPages <= 1) return null
  const from = (page - 1) * pageSize + 1
  const to   = Math.min(page * pageSize, total)

  const pages: (number | '...')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('...')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
    if (page < totalPages - 2) pages.push('...')
    pages.push(totalPages)
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-white/5">
      <p className="text-xs text-gray-600 order-2 sm:order-1">
        Showing <span className="text-gray-400 font-medium">{from}–{to}</span> of{' '}
        <span className="text-gray-400 font-medium">{total}</span>
      </p>
      <div className="flex items-center gap-1 order-1 sm:order-2">
        <button onClick={onPrev} disabled={page === 1}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-white/6 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        {pages.map((p, i) =>
          p === '...'
            ? <span key={`e${i}`} className="w-8 h-8 flex items-center justify-center text-xs text-gray-600">…</span>
            : (
              <button key={p} onClick={() => onPage(p as number)}
                className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all ${
                  page === p ? 'bg-violet-600 text-white shadow-sm shadow-violet-500/30' : 'text-gray-500 hover:text-gray-200 hover:bg-white/6'
                }`}>
                {p}
              </button>
            )
        )}
        <button onClick={onNext} disabled={page === totalPages}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-white/6 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

/* ─── Empty State ────────────────────────────────────────────────────────── */
function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-2xl bg-white/3 border border-white/6 flex items-center justify-center mb-4 text-gray-700">
        {icon}
      </div>
      <p className="text-sm font-semibold text-gray-400">{title}</p>
      <p className="text-xs text-gray-600 mt-1.5 max-w-xs leading-relaxed">{body}</p>
    </div>
  )
}

/* ─── Skeleton row ───────────────────────────────────────────────────────── */
function SkeletonRow({ height = 'h-14' }: { height?: string }) {
  return <div className={`${height} rounded-xl bg-white/3 animate-pulse`} />
}

/* ════════════════════════════════════════════════════════════════════════════
   Main component
═══════════════════════════════════════════════════════════════════════════ */
export default function AdminPage() {
  /* auth */
  const [secret, setSecret]           = useState('')
  const [secretInput, setSecretInput] = useState('')
  const [showSecret, setShowSecret]   = useState(false)
  const [loggedIn, setLoggedIn]       = useState(false)
  const [authError, setAuthError]     = useState('')

  /* data */
  const [tab, setTab]     = useState<'users' | 'logs'>('users')
  const [users, setUsers] = useState<User[]>([])
  const [logs, setLogs]   = useState<Log[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  /* add-user form */
  const [newId, setNewId]         = useState('')
  const [newNote, setNewNote]     = useState('')
  const [adding, setAdding]       = useState(false)
  const [addSuccess, setAddSuccess] = useState('')

  /* filters */
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch]             = useState('')

  /* pagination */
  const [userPage, setUserPage] = useState(1)
  const [logPage, setLogPage]   = useState(1)

  /* ── load ────────────────────────────────────────────────────────────── */
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
  useEffect(() => { setUserPage(1) }, [search, statusFilter])

  /* ── handlers ────────────────────────────────────────────────────────── */
  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    const key = secretInput.trim()
    if (!key) { setAuthError('Please enter your secret key.'); return }
    setAuthError('')
    setSecret(key)
    setLoggedIn(true)
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault()
    if (!newId.trim()) return
    setAdding(true); setAddSuccess(''); setError('')
    try {
      await adminAddUser(secret, newId.trim(), newNote.trim() || undefined)
      setAddSuccess(`"${newId.trim()}" approved successfully.`)
      setNewId(''); setNewNote('')
      load()
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not add user.')
    } finally { setAdding(false) }
  }

  async function handleStatus(identifier: string, status: string) {
    try { await adminUpdateStatus(secret, identifier, status); load() }
    catch { setError('Could not update status.') }
  }

  async function handleDelete(identifier: string) {
    if (!confirm(`Permanently delete "${identifier}"? This cannot be undone.`)) return
    try { await adminDeleteUser(secret, identifier); load() }
    catch { setError('Could not delete user.') }
  }

  /* ── derived ─────────────────────────────────────────────────────────── */
  const filteredUsers = useMemo(() =>
    users.filter(u =>
      u.identifier.toLowerCase().includes(search.toLowerCase()) ||
      (u.note || '').toLowerCase().includes(search.toLowerCase())
    ), [users, search])

  const userTotalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE))
  const pagedUsers     = filteredUsers.slice((userPage - 1) * PAGE_SIZE, userPage * PAGE_SIZE)
  const logTotalPages  = Math.max(1, Math.ceil(logs.length / PAGE_SIZE))
  const pagedLogs      = logs.slice((logPage - 1) * PAGE_SIZE, logPage * PAGE_SIZE)

  const stats = {
    total:    users.length,
    approved: users.filter(u => u.status === 'approved').length,
    pending:  users.filter(u => u.status === 'pending').length,
    blocked:  users.filter(u => u.status === 'blocked').length,
  }

  /* ════════════════════════════════════════════════════════════════════════
     LOGIN SCREEN
  ════════════════════════════════════════════════════════════════════════ */
  if (!loggedIn) {
    return (
      <div className="min-h-screen bg-[#080b14] flex flex-col">
        <Navbar />

        <main className="flex-1 flex items-center justify-center px-4 py-12 relative overflow-hidden">
          {/* decorative glows — absolute, not fixed */}
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute top-0 left-1/4 w-[480px] h-[480px] rounded-full bg-violet-600/8 blur-[120px]" />
            <div className="absolute bottom-0 right-1/4 w-[360px] h-[360px] rounded-full bg-blue-600/6 blur-[120px]" />
          </div>

          <div className="relative w-full max-w-md z-10">
            {/* Icon + badge + heading */}
            <div className="flex flex-col items-center text-center mb-8 gap-3">
              <div className="w-[72px] h-[72px] bg-gradient-to-br from-violet-500 to-violet-700 rounded-[20px] flex items-center justify-center shadow-2xl shadow-violet-500/30">
                <Shield className="w-9 h-9 text-white" strokeWidth={1.75} />
              </div>

              <span className="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/25 text-red-400 text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                Admin Control — Restricted
              </span>

              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                  Administrative Dashboard
                </h1>
                <p className="text-sm text-gray-500 mt-1.5">
                  UniStream Saver · Authorised access only
                </p>
              </div>
            </div>

            {/* Card */}
            <div className="bg-[#10141f] border border-white/[0.08] rounded-2xl p-6 sm:p-8 shadow-2xl shadow-black/50">
              <form onSubmit={handleLogin} className="space-y-4" noValidate>
                <div>
                  <label
                    htmlFor="admin-secret"
                    className="block text-[11px] font-bold text-gray-500 mb-2.5 uppercase tracking-widest"
                  >
                    Admin Secret Key
                  </label>
                  <div className="relative">
                    <input
                      id="admin-secret"
                      type={showSecret ? 'text' : 'password'}
                      value={secretInput}
                      onChange={e => { setSecretInput(e.target.value); setAuthError('') }}
                      onKeyDown={e => e.key === 'Enter' && handleLogin(e as any)}
                      placeholder="Enter your secret key"
                      autoFocus
                      autoComplete="current-password"
                      className={`
                        w-full bg-white/5 rounded-xl px-4 py-3 pr-11 text-sm text-white
                        placeholder-gray-600 border transition-all outline-none
                        focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/60
                        ${authError ? 'border-red-500/50 bg-red-500/5' : 'border-white/10 hover:border-white/15'}
                      `}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(v => !v)}
                      tabIndex={-1}
                      aria-label={showSecret ? 'Hide key' : 'Show key'}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300 transition-colors"
                    >
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {authError && (
                    <p className="flex items-center gap-1.5 text-xs text-red-400 mt-2">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      {authError}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 active:scale-[0.98] text-white font-semibold text-sm py-3.5 rounded-xl transition-all shadow-lg shadow-violet-500/25 select-none"
                >
                  <LogIn className="w-4 h-4" />
                  Sign in to Dashboard
                </button>
              </form>
            </div>

            <p className="text-center text-xs text-gray-700 mt-5">
              Authorised university staff only. All access is logged.
            </p>
          </div>
        </main>

        <Footer />
      </div>
    )
  }

  /* ════════════════════════════════════════════════════════════════════════
     DASHBOARD
  ════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-[#080b14] flex flex-col">
      <Navbar />

      <main className="flex-1 relative overflow-hidden">
        {/* decorative glows — absolute inside a relative container */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute top-0 left-1/4 w-[600px] h-[400px] rounded-full bg-violet-600/6 blur-[130px]" />
          <div className="absolute top-40 right-1/4 w-[400px] h-[300px] rounded-full bg-blue-600/5 blur-[110px]" />
        </div>

        <div className="relative z-10">

          {/* ── Page header ─────────────────────────────────────────────── */}
          <div className="border-b border-white/[0.06] bg-[#080b14]/80 backdrop-blur-xl">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full mb-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  Admin Control — Restricted
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  Administrative Dashboard
                </h1>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                <div className="flex items-center gap-2 bg-emerald-500/8 border border-emerald-500/15 text-emerald-400 text-xs font-semibold px-3 py-2 rounded-xl">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  <span className="hidden sm:inline">Superadmin Session Active</span>
                  <span className="sm:hidden">Live</span>
                </div>
                <button
                  onClick={load}
                  disabled={loading}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-200 px-3 py-2 rounded-xl border border-white/8 hover:border-white/15 hover:bg-white/4 disabled:opacity-50 transition-all"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              </div>
            </div>
          </div>

          {/* ── Body ────────────────────────────────────────────────────── */}
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <StatCard value={stats.total}    label="Total Users"         icon={<Users className="w-5 h-5 text-blue-400" />}    glowClass="bg-blue-500" />
              <StatCard value={stats.approved} label="Approved"            icon={<CheckCircle2 className="w-5 h-5 text-emerald-400" />} glowClass="bg-emerald-500" sublabel="Active access" />
              <StatCard value={stats.pending}  label="Pending Approvals"   icon={<Clock className="w-5 h-5 text-amber-400" />}   glowClass="bg-amber-500"  sublabel={stats.pending > 0 ? 'Requires action' : 'All clear'} />
              <StatCard value={logs.length}    label="Activity Logs"       icon={<Download className="w-5 h-5 text-violet-400" />} glowClass="bg-violet-500" />
            </div>

            {/* Add user */}
            <div className="bg-[#10141f] border border-white/[0.07] rounded-2xl p-5 sm:p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 bg-violet-500/10 border border-violet-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <UserCheck className="w-4 h-4 text-violet-400" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Add Student</h2>
                  <p className="text-xs text-gray-600 mt-0.5">Grant access by Gmail address or phone number</p>
                </div>
              </div>

              <form onSubmit={handleAddUser} noValidate>
                <div className="flex flex-col sm:flex-row gap-2.5 mb-3">
                  <input
                    type="text"
                    value={newId}
                    onChange={e => setNewId(e.target.value)}
                    placeholder="Gmail address or phone number"
                    className="flex-1 bg-white/5 border border-white/10 hover:border-white/15 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/60 transition-all"
                  />
                  <input
                    type="text"
                    value={newNote}
                    onChange={e => setNewNote(e.target.value)}
                    placeholder="Note — e.g. CSE B24"
                    className="sm:w-52 bg-white/5 border border-white/10 hover:border-white/15 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/60 transition-all"
                  />
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    type="submit"
                    disabled={adding || !newId.trim()}
                    className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-all shadow-md shadow-violet-500/20"
                  >
                    {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    {adding ? 'Approving…' : 'Add Student'}
                  </button>
                  {addSuccess && (
                    <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> {addSuccess}
                    </p>
                  )}
                </div>
              </form>

              {error && (
                <div className="mt-4 flex items-start gap-2.5 bg-red-500/8 border border-red-500/18 text-red-400 text-xs rounded-xl px-3.5 py-3">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {error}
                </div>
              )}
            </div>

            {/* Tabs + content */}
            <div className="bg-[#10141f] border border-white/[0.07] rounded-2xl overflow-hidden">

              {/* Tab bar */}
              <div className="flex border-b border-white/[0.07] overflow-x-auto">
                {([
                  ['users', 'User Management', <Users className="w-4 h-4" />, users.length],
                  ['logs',  'Live Logs',        <Activity className="w-4 h-4" />, logs.length],
                ] as const).map(([t, label, icon, count]) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`flex items-center gap-2 px-5 py-4 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-all ${
                      tab === t
                        ? 'border-violet-500 text-violet-400 bg-violet-500/5'
                        : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-white/3'
                    }`}
                  >
                    {icon}
                    {label}
                    {count > 0 && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                        tab === t ? 'bg-violet-500/20 text-violet-300' : 'bg-white/6 text-gray-600'
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* ── Users tab ─────────────────────────────────────────── */}
              {tab === 'users' && (
                <div className="p-4 sm:p-5 space-y-4">

                  {/* Filters */}
                  <div className="flex flex-col xs:flex-row gap-2.5">
                    <div className="relative flex-1">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600 pointer-events-none" />
                      <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search by name, email…"
                        className="w-full bg-white/5 border border-white/10 hover:border-white/15 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-violet-500/40 transition-all"
                      />
                    </div>
                    <div className="relative xs:w-44">
                      <select
                        value={statusFilter}
                        onChange={e => { setStatusFilter(e.target.value); load() }}
                        className="w-full bg-white/5 border border-white/10 hover:border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-gray-300 appearance-none cursor-pointer outline-none focus:ring-2 focus:ring-violet-500/40 transition-all pr-9"
                      >
                        <option value="">All</option>
                        <option value="approved">Approved</option>
                        <option value="pending">Pending</option>
                        <option value="blocked">Revoked</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
                    </div>
                  </div>

                  {/* Content */}
                  {loading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
                    </div>
                  ) : filteredUsers.length === 0 ? (
                    <EmptyState
                      icon={<Users className="w-5 h-5" />}
                      title="No users found"
                      body={search || statusFilter ? 'Try adjusting your search or filter.' : 'Approve the first user using the form above.'}
                    />
                  ) : (
                    <>
                      {/* Column headers — desktop */}
                      <div className="hidden sm:grid grid-cols-[1fr_160px_140px_auto] gap-4 px-4 py-1.5">
                        {['Student', 'Note', 'Status', 'Actions'].map(h => (
                          <span key={h} className="text-[11px] font-bold text-gray-600 uppercase tracking-wider last:text-right">{h}</span>
                        ))}
                      </div>

                      <div className="divide-y divide-white/[0.05]">
                        {pagedUsers.map(user => (
                          <div key={user.id}
                            className="flex flex-col sm:grid sm:grid-cols-[1fr_160px_140px_auto] sm:items-center gap-2 sm:gap-4 px-4 py-3.5 hover:bg-white/[0.02] group transition-colors">

                            {/* Identifier + date */}
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-8 h-8 rounded-full bg-violet-500/15 border border-violet-500/25 flex items-center justify-center flex-shrink-0">
                                <span className="text-xs font-bold text-violet-300">
                                  {user.identifier[0]?.toUpperCase() ?? '?'}
                                </span>
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-white truncate">{user.identifier}</p>
                                <p className="text-[11px] text-gray-700">
                                  {new Date(user.created_at).toLocaleDateString('en-GB', {
                                    day: 'numeric', month: 'short', year: 'numeric',
                                  })}
                                </p>
                              </div>
                            </div>

                            {/* Note */}
                            <div className="pl-11 sm:pl-0">
                              {user.note
                                ? <span className="text-xs text-gray-500 bg-white/5 border border-white/8 px-2 py-0.5 rounded-lg">{user.note}</span>
                                : <span className="text-gray-700 text-xs">—</span>
                              }
                            </div>

                            {/* Status */}
                            <div className="pl-11 sm:pl-0">
                              <StatusBadge status={user.status} />
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1 pl-11 sm:pl-0 sm:justify-end opacity-60 group-hover:opacity-100 transition-opacity">
                              {user.status !== 'approved' && (
                                <button
                                  onClick={() => handleStatus(user.identifier, 'approved')}
                                  className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 px-2.5 py-1.5 rounded-lg transition-colors"
                                >
                                  Approve
                                </button>
                              )}
                              {user.status !== 'blocked' && (
                                <button
                                  onClick={() => handleStatus(user.identifier, 'blocked')}
                                  className="text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 px-2.5 py-1.5 rounded-lg transition-colors"
                                >
                                  Revoke
                                </button>
                              )}
                              <button
                                onClick={() => handleDelete(user.identifier)}
                                title="Delete"
                                className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors ml-0.5"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="px-4">
                        <Pagination
                          page={userPage} totalPages={userTotalPages}
                          total={filteredUsers.length} pageSize={PAGE_SIZE}
                          onPrev={() => setUserPage(p => Math.max(1, p - 1))}
                          onNext={() => setUserPage(p => Math.min(userTotalPages, p + 1))}
                          onPage={setUserPage}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Logs tab ───────────────────────────────────────────── */}
              {tab === 'logs' && (
                <div className="p-4 sm:p-5 space-y-4">
                  {loading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} height="h-16" />)}
                    </div>
                  ) : logs.length === 0 ? (
                    <EmptyState
                      icon={<Download className="w-5 h-5" />}
                      title="No downloads yet"
                      body="Activity will appear here once users start downloading."
                    />
                  ) : (
                    <>
                      {/* Column headers */}
                      <div className="hidden sm:grid grid-cols-[1fr_200px_36px] gap-4 px-4 py-1.5">
                        {['Video', 'User · Time', ''].map((h, i) => (
                          <span key={i} className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">{h}</span>
                        ))}
                      </div>

                      <div className="divide-y divide-white/[0.05]">
                        {pagedLogs.map(log => (
                          <div key={log.id}
                            className="flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.02] group transition-colors">

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                {log.platform && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-violet-500/10 text-violet-400 border border-violet-500/20 flex-shrink-0">
                                    {log.platform}
                                  </span>
                                )}
                                <p className="text-sm font-medium text-white truncate">
                                  {log.title || 'Untitled video'}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <p className="text-[11px] text-gray-600 truncate">{log.identifier}</p>
                                <span className="text-gray-800 text-[11px] flex-shrink-0">·</span>
                                <span className="text-[11px] text-gray-700 flex-shrink-0">
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
                              className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-gray-700 hover:text-violet-400 hover:bg-violet-500/10 transition-colors opacity-50 group-hover:opacity-100"
                              title="Open video"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        ))}
                      </div>

                      <div className="px-4">
                        <Pagination
                          page={logPage} totalPages={logTotalPages}
                          total={logs.length} pageSize={PAGE_SIZE}
                          onPrev={() => setLogPage(p => Math.max(1, p - 1))}
                          onNext={() => setLogPage(p => Math.min(logTotalPages, p + 1))}
                          onPage={setLogPage}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}