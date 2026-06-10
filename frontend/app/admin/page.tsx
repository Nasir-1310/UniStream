'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  adminListUsers, adminAddUser, adminUpdateStatus,
  adminDeleteUser, adminGetLogs
} from '@/lib/api'
import {
  Shield, Plus, Trash2, CheckCircle2, XCircle,
  Clock, Loader2, AlertCircle, Users, Activity,
  LogIn, Eye, EyeOff, RefreshCw, Search
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
  approved: { label: 'অ্যাপ্রুভড', color: 'text-brand-400', bg: 'bg-brand-500/10 border-brand-500/20', icon: <CheckCircle2 className="w-3 h-3" /> },
  pending:  { label: 'পেন্ডিং',   color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20', icon: <Clock className="w-3 h-3" /> },
  blocked:  { label: 'ব্লকড',     color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20',       icon: <XCircle className="w-3 h-3" /> },
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

  // Add user form
  const [newId, setNewId] = useState('')
  const [newNote, setNewNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [addSuccess, setAddSuccess] = useState('')

  // Filter
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
        setError('সিক্রেট কী ভুল।')
      } else {
        setError('ডেটা লোড করা যায়নি।')
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
      setAddSuccess(`"${newId.trim()}" অ্যাপ্রুভ করা হয়েছে!`)
      setNewId('')
      setNewNote('')
      load()
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'ইউজার অ্যাড করা যায়নি।')
    } finally {
      setAdding(false)
    }
  }

  async function handleStatus(identifier: string, status: string) {
    try {
      await adminUpdateStatus(secret, identifier, status)
      load()
    } catch { setError('স্ট্যাটাস আপডেট করা যায়নি।') }
  }

  async function handleDelete(identifier: string) {
    if (!confirm(`"${identifier}" ডিলিট করতে চান?`)) return
    try {
      await adminDeleteUser(secret, identifier)
      load()
    } catch { setError('ডিলিট করা যায়নি।') }
  }

  const filteredUsers = users.filter(u =>
    u.identifier.toLowerCase().includes(search.toLowerCase()) ||
    (u.note || '').toLowerCase().includes(search.toLowerCase())
  )

  // ── Login Screen ──
  if (!loggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm glass p-6">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="font-bold text-white text-sm">Admin Panel</div>
              <div className="text-xs text-gray-500">UniStream Saver</div>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Admin Secret Key</label>
              <div className="relative">
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={secretInput}
                  onChange={e => setSecretInput(e.target.value)}
                  placeholder="আপনার সিক্রেট কী দিন"
                  className="input-field pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {authError && <p className="text-xs text-red-400">{authError}</p>}
            <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2">
              <LogIn className="w-4 h-4" /> লগইন
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ── Admin Dashboard ──
  const stats = {
    total: users.length,
    approved: users.filter(u => u.status === 'approved').length,
    pending: users.filter(u => u.status === 'pending').length,
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-brand-500" />
          <span className="font-bold text-white text-sm">Admin Panel</span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          রিফ্রেশ
        </button>
      </header>

      <main className="max-w-3xl mx-auto w-full px-4 py-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'মোট ইউজার', value: stats.total, color: 'text-white' },
            { label: 'অ্যাপ্রুভড', value: stats.approved, color: 'text-brand-400' },
            { label: 'পেন্ডিং', value: stats.pending, color: 'text-yellow-400' },
          ].map(s => (
            <div key={s.label} className="glass p-3 text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Add User */}
        <div className="glass p-4">
          <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Plus className="w-4 h-4 text-brand-500" /> নতুন ইউজার অ্যাড করুন
          </h2>
          <form onSubmit={handleAddUser} className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={newId}
                onChange={e => setNewId(e.target.value)}
                placeholder="Gmail বা Phone Number"
                className="input-field text-sm flex-1"
              />
              <input
                type="text"
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="নোট (CSE B24)"
                className="input-field text-sm w-32"
              />
            </div>
            <button type="submit" disabled={adding || !newId.trim()} className="btn-primary text-sm flex items-center gap-1.5">
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              অ্যাপ্রুভ করুন
            </button>
          </form>
          {addSuccess && <p className="text-xs text-brand-400 mt-2">✓ {addSuccess}</p>}
          {error && (
            <div className="flex items-center gap-1.5 text-xs text-red-400 mt-2">
              <AlertCircle className="w-3.5 h-3.5" /> {error}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
          {([['users', 'ইউজার', <Users className="w-3.5 h-3.5" />], ['logs', 'লগ', <Activity className="w-3.5 h-3.5" />]] as const).map(([t, label, icon]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-xs font-medium transition-all ${
                tab === t ? 'bg-brand-500 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {icon}{label}
            </button>
          ))}
        </div>

        {tab === 'users' && (
          <>
            {/* Filters */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="ইউজার খুঁজুন..."
                  className="input-field pl-8 text-sm py-2"
                />
              </div>
              <select
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value); load() }}
                className="input-field text-sm py-2 w-32"
              >
                <option value="">সব</option>
                <option value="approved">অ্যাপ্রুভড</option>
                <option value="pending">পেন্ডিং</option>
                <option value="blocked">ব্লকড</option>
              </select>
            </div>

            {/* User List */}
            {loading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-14 rounded-lg shimmer" />)}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredUsers.length === 0 && (
                  <div className="text-center py-8 text-gray-600 text-sm">কোনো ইউজার নেই</div>
                )}
                {filteredUsers.map(user => {
                  const sc = STATUS_CONFIG[user.status]
                  return (
                    <div key={user.id} className="glass p-3 flex items-center gap-3">
                      <div className={`badge border ${sc.bg} ${sc.color} flex-shrink-0`}>
                        {sc.icon} {sc.label}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-sm font-medium truncate">{user.identifier}</div>
                        {user.note && <div className="text-xs text-gray-500 truncate">{user.note}</div>}
                        <div className="text-xs text-gray-700">
                          {new Date(user.created_at).toLocaleDateString('bn-BD')}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {user.status !== 'approved' && (
                          <button
                            onClick={() => handleStatus(user.identifier, 'approved')}
                            title="অ্যাপ্রুভ"
                            className="p-1.5 rounded hover:bg-brand-500/20 text-brand-500 transition-colors"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                        {user.status !== 'blocked' && (
                          <button
                            onClick={() => handleStatus(user.identifier, 'blocked')}
                            title="ব্লক"
                            className="p-1.5 rounded hover:bg-red-500/20 text-red-500 transition-colors"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(user.identifier)}
                          title="ডিলিট"
                          className="p-1.5 rounded hover:bg-red-500/20 text-red-700 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {tab === 'logs' && (
          <div className="space-y-2">
            {loading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-14 rounded-lg shimmer" />)}
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8 text-gray-600 text-sm">কোনো লগ নেই</div>
            ) : (
              logs.map(log => (
                <div key={log.id} className="glass p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-medium truncate">{log.title || 'Unknown'}</div>
                      <div className="text-gray-500 text-xs truncate">{log.identifier}</div>
                      <div className="flex gap-2 mt-1">
                        {log.platform && (
                          <span className="badge bg-brand-500/10 text-brand-400 border border-brand-500/20">
                            {log.platform}
                          </span>
                        )}
                        <span className="text-xs text-gray-700">
                          {new Date(log.created_at).toLocaleString('bn-BD')}
                        </span>
                      </div>
                    </div>
                    <a
                      href={log.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-600 hover:text-brand-400 transition-colors flex-shrink-0"
                    >
                      <Activity className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  )
}
