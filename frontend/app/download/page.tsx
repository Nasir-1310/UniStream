'use client'
// frontend/app/download/page.tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getVideoInfo, VideoInfo, VideoFormat } from '@/lib/api'
import {
  Download, LogOut, Link2, Loader2, AlertCircle, CheckCircle2,
  Film, Music, Clock, User, RefreshCw, XCircle, Play,
  Clipboard, Shield, Zap, HardDrive, Timer, BarChart3,
  Merge, FileDown, CircleCheck, TriangleAlert,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type DlStatus = 'idle' | 'starting' | 'downloading' | 'merging' | 'complete' | 'error'

interface ProgressData {
  status:         DlStatus
  percent:        number          // 0–100
  speed:          string          // "4.2 MB/s"
  eta:            string          // "01:23"
  downloaded_fmt: string          // "42.1 MB"
  total_fmt:      string          // "310.5 MB"
  downloaded:     number          // bytes
  total:          number | null   // bytes | null when unknown
  token?:         string          // set on 'complete'
  error?:         string          // set on 'error'
}

type FormatDlState =
  | { status: 'idle' }
  | { status: 'active'; progress: ProgressData }
  | { status: 'complete' }
  | { status: 'error'; message: string }

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDuration(s: number): string {
  if (!s) return ''
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

const PLATFORM_COLORS: Record<string, string> = {
  YouTube:   'bg-red-500/15 text-red-400 border-red-500/25',
  Facebook:  'bg-blue-500/15 text-blue-400 border-blue-500/25',
  Instagram: 'bg-pink-500/15 text-pink-400 border-pink-500/25',
  TikTok:    'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
}

function PlatformBadge({ platform }: { platform: string }) {
  const cls = PLATFORM_COLORS[platform] ?? 'bg-brand-500/15 text-brand-400 border-brand-500/25'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      {platform}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ProgressPanel  — the rich live progress UI shown while downloading
// ─────────────────────────────────────────────────────────────────────────────

function ProgressPanel({
  fmt,
  progress,
  onDismiss,
}: {
  fmt: VideoFormat
  progress: ProgressData
  onDismiss?: () => void
}) {
  const { status, percent, speed, eta, downloaded_fmt, total_fmt } = progress

  const isActive   = status === 'downloading' || status === 'starting'
  const isMerging  = status === 'merging'
  const isComplete = status === 'complete'
  const isError    = status === 'error'

  // Smooth animated percent (avoids jumps from 0→actual on first render)
  const displayPct = isComplete ? 100 : percent

  // Status config
  const statusConfig: Record<DlStatus, { label: string; color: string; pulse: boolean }> = {
    idle:        { label: 'Waiting',    color: 'text-gray-400',    pulse: false },
    starting:    { label: 'Starting…',  color: 'text-brand-400',   pulse: true  },
    downloading: { label: 'Downloading',color: 'text-brand-400',   pulse: true  },
    merging:     { label: 'Merging…',   color: 'text-purple-400',  pulse: true  },
    complete:    { label: 'Complete',   color: 'text-emerald-400', pulse: false },
    error:       { label: 'Failed',     color: 'text-red-400',     pulse: false },
  }
  const sc = statusConfig[status]

  // Progress bar gradient
  const barGradient = isComplete
    ? 'from-emerald-500 to-emerald-400'
    : isMerging
    ? 'from-purple-500 to-violet-400'
    : 'from-brand-500 to-emerald-400'

  return (
    <div className={`dl-card p-5 space-y-4 transition-all duration-300 ${
      isComplete ? 'border-emerald-500/25' : isError ? 'border-red-500/20' : 'border-brand-500/15'
    }`}>
      {/* ── Header row ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Format icon */}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl ${
            isComplete ? 'bg-emerald-500/15' : isError ? 'bg-red-500/10' : 'bg-brand-500/12'
          }`}>
            {fmt.icon}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">{fmt.label}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {/* Pulse dot */}
              {sc.pulse && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500" />
                </span>
              )}
              <span className={`text-xs font-semibold ${sc.color}`}>{sc.label}</span>
              {isActive && (
                <span className="text-xs text-gray-600">· {fmt.ext.toUpperCase()}</span>
              )}
            </div>
          </div>
        </div>

        {/* Percentage badge */}
        <div className={`flex-shrink-0 text-right`}>
          {isComplete ? (
            <div className="w-9 h-9 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CircleCheck className="w-5 h-5 text-emerald-400" />
            </div>
          ) : isError ? (
            <div className="w-9 h-9 rounded-full bg-red-500/12 flex items-center justify-center">
              <TriangleAlert className="w-5 h-5 text-red-400" />
            </div>
          ) : isMerging ? (
            <div className="w-9 h-9 rounded-full bg-purple-500/12 flex items-center justify-center">
              <Merge className="w-5 h-5 text-purple-400" />
            </div>
          ) : (
            <div className="relative w-12 h-12 flex-shrink-0">
              {/* Circular progress ring */}
              <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
                <circle cx="24" cy="24" r="20" fill="none" strokeWidth="3"
                  className="stroke-white/8" />
                <circle cx="24" cy="24" r="20" fill="none" strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 20}`}
                  strokeDashoffset={`${2 * Math.PI * 20 * (1 - displayPct / 100)}`}
                  className="stroke-brand-500 transition-[stroke-dashoffset] duration-500 ease-out" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white">
                {displayPct}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Progress bar ── */}
      {!isError && (
        <div>
          <div className="relative h-2 bg-white/6 rounded-full overflow-hidden">
            {isMerging ? (
              /* Indeterminate bar for merging */
              <div className="absolute inset-y-0 w-1/2 rounded-full bg-gradient-to-r from-purple-500/0 via-purple-400 to-purple-500/0 animate-[slide_1.5s_ease-in-out_infinite]" />
            ) : (
              <div
                className={`h-full rounded-full bg-gradient-to-r ${barGradient} transition-[width] duration-500 ease-out`}
                style={{ width: `${displayPct}%` }}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Stats grid ── */}
      {(isActive || isMerging || isComplete) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">

          {/* Speed */}
          <StatPill
            icon={<Zap className="w-3 h-3" />}
            label="Speed"
            value={isActive ? speed : '—'}
            accent={isActive}
          />

          {/* ETA */}
          <StatPill
            icon={<Timer className="w-3 h-3" />}
            label="ETA"
            value={isComplete ? '00:00' : isMerging ? 'Processing' : eta}
            accent={isActive}
          />

          {/* Downloaded */}
          <StatPill
            icon={<FileDown className="w-3 h-3" />}
            label="Downloaded"
            value={isComplete ? total_fmt : `${downloaded_fmt} / ${total_fmt}`}
            accent={false}
          />

          {/* Progress % */}
          <StatPill
            icon={<BarChart3 className="w-3 h-3" />}
            label="Progress"
            value={isComplete ? '100%' : isMerging ? '99%' : `${displayPct}%`}
            accent={isComplete}
            accentColor={isComplete ? 'text-emerald-400' : undefined}
          />
        </div>
      )}

      {/* ── Error message ── */}
      {isError && (
        <div className="flex items-start gap-2.5 bg-red-500/8 border border-red-500/20 text-red-300 text-xs rounded-xl px-3.5 py-3">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{progress.error || 'Download failed. Please try again.'}</span>
        </div>
      )}

      {/* ── Complete message ── */}
      {isComplete && (
        <div className="flex items-center gap-2.5 bg-emerald-500/8 border border-emerald-500/20 text-emerald-300 text-xs rounded-xl px-3.5 py-3">
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Your file is saved to your Downloads folder.</span>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="ml-auto text-emerald-500 hover:text-emerald-300 transition-colors text-xs font-medium"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* ── Merging info ── */}
      {isMerging && (
        <div className="flex items-center gap-2.5 bg-purple-500/8 border border-purple-500/20 text-purple-300 text-xs rounded-xl px-3.5 py-3">
          <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" />
          <span>Merging video and audio tracks — almost done…</span>
        </div>
      )}
    </div>
  )
}

// ── Small stat pill ───────────────────────────────────────────────────────────
function StatPill({
  icon, label, value, accent, accentColor,
}: {
  icon: React.ReactNode
  label: string
  value: string
  accent: boolean
  accentColor?: string
}) {
  return (
    <div className="bg-white/3 border border-white/6 rounded-xl px-3 py-2.5">
      <div className={`flex items-center gap-1.5 mb-1 ${accent ? 'text-brand-400' : 'text-gray-600'}`}>
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-xs font-bold truncate ${accentColor ?? (accent ? 'text-brand-300' : 'text-gray-300')}`}>
        {value}
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FormatButton  — compact card in the format grid
// ─────────────────────────────────────────────────────────────────────────────

function FormatButton({
  fmt,
  dlState,
  onDownload,
  locked,
}: {
  fmt:       VideoFormat
  dlState:   FormatDlState
  onDownload:(f: VideoFormat) => void
  locked:    boolean
}) {
  const isActive   = dlState.status === 'active'
  const isComplete = dlState.status === 'complete'
  const isError    = dlState.status === 'error'
  const isIdle     = dlState.status === 'idle'
  const isDisabled = isActive || locked

  const progress = isActive ? dlState.progress : null
  const pct      = progress?.percent ?? 0

  const containerCls = [
    'relative overflow-hidden flex items-center gap-3 p-3.5 rounded-xl border',
    'transition-all duration-200 text-left w-full group',
    isComplete ? 'border-emerald-500/30 bg-emerald-500/8 cursor-default'
    : isError   ? 'border-red-500/25 bg-red-500/6 cursor-pointer hover:border-red-500/40'
    : isActive  ? 'border-brand-500/35 bg-brand-500/6 cursor-wait'
    : locked    ? 'border-white/5 bg-white/2 opacity-35 cursor-not-allowed'
    :             'border-white/8 bg-white/2 hover:border-brand-500/35 hover:bg-brand-500/6 cursor-pointer',
  ].join(' ')

  return (
    <button
      onClick={() => !isDisabled && !isComplete && onDownload(fmt)}
      disabled={isDisabled}
      className={containerCls}
      title={isError ? (dlState as any).message : undefined}
    >
      {/* Thin progress fill strip at the bottom */}
      {isActive && (
        <div
          className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-brand-500 to-emerald-400 transition-[width] duration-500 ease-out pointer-events-none"
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      )}

      {/* Format emoji */}
      <span className="relative text-2xl leading-none flex-shrink-0 select-none" aria-hidden="true">
        {fmt.icon}
      </span>

      {/* Labels */}
      <div className="relative flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate leading-tight ${
          isComplete ? 'text-emerald-300' : isError ? 'text-red-300' : 'text-white'
        }`}>
          {fmt.label}
        </p>
        <p className={`text-xs mt-0.5 truncate ${
          isActive    ? 'text-brand-400'
          : isComplete ? 'text-emerald-500'
          : isError    ? 'text-red-500'
          :              'text-gray-500'
        }`}>
          {isActive
            ? `${pct}% · ${progress?.speed ?? '…'}`
            : isComplete
            ? 'Saved to downloads'
            : isError
            ? 'Failed — tap to retry'
            : `${fmt.filesize_human || ''} · ${fmt.ext.toUpperCase()}`}
        </p>
      </div>

      {/* Right indicator */}
      <div className="relative flex-shrink-0">
        {isActive ? (
          <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
        ) : isComplete ? (
          <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
        ) : isError ? (
          <div className="w-8 h-8 rounded-full bg-red-500/15 flex items-center justify-center">
            <XCircle className="w-4 h-4 text-red-400" />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-brand-500/15 transition-colors">
            <Download className="w-3.5 h-3.5 text-gray-500 group-hover:text-brand-400 transition-colors" />
          </div>
        )}
      </div>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function DownloadPage() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [name,       setName]       = useState('')
  const [url,        setUrl]        = useState('')
  const [fetching,   setFetching]   = useState(false)
  const [videoInfo,  setVideoInfo]  = useState<VideoInfo | null>(null)
  const [fetchError, setFetchError] = useState('')

  // Per-format state
  const [dlStates,    setDlStates]    = useState<Record<string, FormatDlState>>({})
  // The format that has an active SSE connection
  const [activeId,    setActiveId]    = useState<string | null>(null)
  // Full progress data for the active download (drives ProgressPanel)
  const [activeProgress, setActiveProgress] = useState<ProgressData | null>(null)
  const [activeFmt,   setActiveFmt]   = useState<VideoFormat | null>(null)
  const sseRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const id = sessionStorage.getItem('us_identifier')
    const n  = sessionStorage.getItem('us_name')
    if (!id) { router.push('/'); return }
    setIdentifier(id)
    setName(n || id)
  }, [router])

  function setFmtState(fmtId: string, state: FormatDlState) {
    setDlStates(prev => ({ ...prev, [fmtId]: state }))
  }

  function handleLogout() {
    sseRef.current?.close()
    sessionStorage.clear()
    router.push('/')
  }

  async function handleFetch(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    sseRef.current?.close()
    setFetching(true)
    setFetchError('')
    setVideoInfo(null)
    setDlStates({})
    setActiveId(null)
    setActiveProgress(null)
    setActiveFmt(null)
    try {
      const info = await getVideoInfo(url.trim(), identifier)
      setVideoInfo(info)
    } catch (err: any) {
      setFetchError(err?.response?.data?.detail || 'Could not fetch video info. Check the link and try again.')
    } finally {
      setFetching(false)
    }
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setUrl(text)
    } catch { /* denied — silent */ }
  }

  // ── SSE download ─────────────────────────────────────────────────────────
  const handleDownload = useCallback((fmt: VideoFormat) => {
    if (activeId !== null) return   // one at a time

    const fmtId  = fmt.format_id
    const base   = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    const sseUrl = `${base}/download/progress?url=${encodeURIComponent(url.trim())}&format_id=${fmtId}&identifier=${encodeURIComponent(identifier)}&ext=${fmt.ext}`

    setActiveId(fmtId)
    setActiveFmt(fmt)
    setFmtState(fmtId, { status: 'active', progress: { status: 'starting', percent: 0, speed: '0 KB/s', eta: '--:--', downloaded_fmt: '0 KB', total_fmt: '?', downloaded: 0, total: null } })
    setActiveProgress({ status: 'starting', percent: 0, speed: '0 KB/s', eta: '--:--', downloaded_fmt: '0 KB', total_fmt: '?', downloaded: 0, total: null })

    const es = new EventSource(sseUrl)
    sseRef.current = es

    es.onmessage = (ev) => {
      let data: ProgressData
      try { data = JSON.parse(ev.data) } catch { return }

      setActiveProgress(data)
      setFmtState(fmtId, { status: 'active', progress: data })

      if (data.status === 'complete' && data.token) {
        es.close()
        sseRef.current = null

        // Trigger browser file download via token
        const fileUrl = `${base}/download/file?token=${data.token}`
        const a = document.createElement('a')
        a.href = fileUrl
        a.download = ''
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)

        // Update states
        setFmtState(fmtId, { status: 'complete' })
        setActiveProgress({ ...data, status: 'complete', percent: 100 })
        // Keep progress panel visible — don't clear activeId yet
      }

      if (data.status === 'error') {
        es.close()
        sseRef.current = null
        setFmtState(fmtId, { status: 'error', message: data.error || 'Download failed.' })
        setActiveProgress(data)
        setActiveId(null)
      }
    }

    es.onerror = () => {
      es.close()
      sseRef.current = null
      const errMsg = 'Connection lost. Please try again.'
      setFmtState(fmtId, { status: 'error', message: errMsg })
      setActiveProgress(prev => prev ? { ...prev, status: 'error', error: errMsg } : null)
      setActiveId(null)
    }
  }, [activeId, url, identifier])

  function dismissProgress() {
    setActiveId(null)
    setActiveProgress(null)
    setActiveFmt(null)
  }

  function handleReset() {
    sseRef.current?.close()
    setUrl('')
    setVideoInfo(null)
    setFetchError('')
    setDlStates({})
    setActiveId(null)
    setActiveProgress(null)
    setActiveFmt(null)
  }

  const videoFormats = videoInfo?.formats.filter(f => f.type === 'video') ?? []
  const audioFormats = videoInfo?.formats.filter(f => f.type === 'audio') ?? []
  const anyActive    = activeId !== null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-[#0a0d14]">

      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px] rounded-full bg-brand-500/5 blur-[110px]" />
      </div>

      {/* ── Header ── */}
      <header className="relative z-20 sticky top-0 border-b border-white/5 bg-[#0a0d14]/90 backdrop-blur-xl px-4 sm:px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
              <Download className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <span className="font-bold text-white text-sm font-display tracking-tight">UniStream Saver</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden sm:flex items-center gap-2 bg-brand-500/10 border border-brand-500/20 px-3 py-1.5 rounded-full">
              <User className="w-3 h-3 text-brand-400" />
              <span className="text-brand-300 text-xs font-medium truncate max-w-[140px]">{name}</span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-400 transition-colors py-1.5 px-3 rounded-lg hover:bg-red-500/10 border border-transparent hover:border-red-500/15"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-5">

        {/* Hero */}
        <div className="text-center space-y-2 pb-2">
          <div className="inline-flex items-center gap-1.5 bg-brand-500/10 border border-brand-500/20 text-brand-300 text-xs font-semibold px-3 py-1.5 rounded-full">
            <Shield className="w-3 h-3" />
            Access verified
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white font-display tracking-tight">
            Paste a video link
          </h1>
          <p className="text-gray-500 text-sm">YouTube · Facebook · Instagram · TikTok and more</p>
        </div>

        {/* URL input */}
        <form onSubmit={handleFetch} className="dl-card p-4 sm:p-5 space-y-3">
          <div className="flex gap-2.5">
            <div className="relative flex-1 min-w-0">
              <Link2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600 pointer-events-none" />
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=…"
                className="input-field pl-10 text-sm w-full"
                disabled={fetching}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <button type="button" onClick={handlePaste} disabled={fetching}
              className="btn-outline hidden sm:flex items-center gap-1.5 text-sm px-3 flex-shrink-0">
              <Clipboard className="w-3.5 h-3.5" /> Paste
            </button>
            <button type="submit" disabled={fetching || !url.trim()}
              className="btn-primary flex items-center gap-2 text-sm flex-shrink-0">
              {fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
              <span className="hidden sm:inline">{fetching ? 'Fetching…' : 'Fetch video'}</span>
            </button>
          </div>
          {fetchError && (
            <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl px-3.5 py-3">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{fetchError}</span>
            </div>
          )}
        </form>

        {/* Loading skeleton */}
        {fetching && (
          <div className="dl-card p-5 space-y-5">
            <div className="flex gap-4">
              <div className="w-28 h-[80px] rounded-xl bg-white/5 flex-shrink-0 shimmer" />
              <div className="flex-1 space-y-2.5 pt-1">
                <div className="h-4 rounded-lg bg-white/5 w-4/5 shimmer" />
                <div className="h-3 rounded-lg bg-white/5 w-1/2 shimmer" />
                <div className="h-3 rounded-lg bg-white/5 w-1/4 shimmer" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[1,2,3,4].map(i => <div key={i} className="h-16 rounded-xl bg-white/5 shimmer" />)}
            </div>
          </div>
        )}

        {/* Video info + formats */}
        {videoInfo && !fetching && (
          <div className="space-y-4 fade-up">

            {/* Metadata card */}
            <div className="dl-card p-4 sm:p-5">
              <div className="flex gap-4 items-start">
                {videoInfo.thumbnail && (
                  <img src={videoInfo.thumbnail} alt={videoInfo.title}
                    className="w-28 sm:w-36 rounded-xl object-cover bg-white/5 flex-shrink-0"
                    style={{ height: 80, objectFit: 'cover' }}
                    onError={e => (e.currentTarget.style.display = 'none')} />
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-white font-semibold text-sm sm:text-base leading-snug line-clamp-2 mb-2.5 font-display">
                    {videoInfo.title}
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {videoInfo.platform && <PlatformBadge platform={videoInfo.platform} />}
                    {videoInfo.uploader && (
                      <span className="flex items-center gap-1.5 text-xs text-gray-500">
                        <User className="w-3 h-3" />{videoInfo.uploader}
                      </span>
                    )}
                    {videoInfo.duration > 0 && (
                      <span className="flex items-center gap-1.5 text-xs text-gray-500">
                        <Clock className="w-3 h-3" />{formatDuration(videoInfo.duration)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── LIVE PROGRESS PANEL ── shown whenever a download is active or complete */}
            {activeProgress && activeFmt && (
              <ProgressPanel
                fmt={activeFmt}
                progress={activeProgress}
                onDismiss={activeProgress.status === 'complete' || activeProgress.status === 'error'
                  ? dismissProgress : undefined}
              />
            )}

            {/* Lock notice when downloading */}
            {anyActive && activeProgress?.status !== 'complete' && activeProgress?.status !== 'error' && (
              <div className="flex items-center gap-2.5 text-xs text-brand-300 bg-brand-500/8 border border-brand-500/15 rounded-xl px-4 py-3">
                <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0 text-brand-400" />
                Download in progress — other formats are locked until it completes.
              </div>
            )}

            {/* Video formats */}
            {videoFormats.length > 0 && (
              <div className="dl-card p-4 sm:p-5 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Film className="w-4 h-4 text-gray-500" />
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Video quality</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {videoFormats.map(fmt => (
                    <FormatButton key={fmt.format_id} fmt={fmt}
                      dlState={dlStates[fmt.format_id] ?? { status: 'idle' }}
                      onDownload={handleDownload}
                      locked={anyActive && activeId !== fmt.format_id} />
                  ))}
                </div>
              </div>
            )}

            {/* Audio formats */}
            {audioFormats.length > 0 && (
              <div className="dl-card p-4 sm:p-5 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Music className="w-4 h-4 text-gray-500" />
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Audio only</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {audioFormats.map(fmt => (
                    <FormatButton key={fmt.format_id} fmt={fmt}
                      dlState={dlStates[fmt.format_id] ?? { status: 'idle' }}
                      onDownload={handleDownload}
                      locked={anyActive && activeId !== fmt.format_id} />
                  ))}
                </div>
              </div>
            )}

            {/* Reset */}
            <button onClick={handleReset} disabled={anyActive && activeProgress?.status !== 'complete'}
              className="btn-outline w-full flex items-center justify-center gap-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed">
              <RefreshCw className="w-3.5 h-3.5" />
              Download another video
            </button>
          </div>
        )}

        {/* Empty state */}
        {!videoInfo && !fetching && !fetchError && (
          <div className="dl-card flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/15 flex items-center justify-center mb-5">
              <Film className="w-7 h-7 text-brand-500/70" />
            </div>
            <p className="text-base font-semibold text-gray-400 font-display">Ready to download</p>
            <p className="text-sm text-gray-600 mt-1.5 max-w-xs">
              Paste any YouTube, Facebook, Instagram, or TikTok link above and choose your quality.
            </p>
          </div>
        )}
      </main>

      <footer className="relative z-10 border-t border-white/5 px-4 py-4 text-center text-xs text-gray-700">
        UniStream Saver · Personal use only · Respect copyright laws
      </footer>
    </div>
  )
}