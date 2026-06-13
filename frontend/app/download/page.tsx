'use client'
// frontend/app/download/page.tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getVideoInfo, VideoInfo, VideoFormat } from '@/lib/api'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import {
  Download, LogOut, Link2, Loader2, AlertCircle, CheckCircle2,
  Film, Clock, RefreshCw, XCircle, Play, Clipboard,
  CircleCheck, Eye, ThumbsUp, Calendar, Globe, Hash, Layers,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type DlStatus = 'idle' | 'starting' | 'downloading' | 'merging' | 'complete' | 'error'

interface ProgressData {
  status:         DlStatus
  percent:        number
  speed:          string
  eta:            string
  downloaded_fmt: string
  total_fmt:      string
  downloaded:     number
  total:          number | null
  token?:         string
  error?:         string
}

type FormatDlState =
  | { status: 'idle' }
  | { status: 'active'; progress: ProgressData }
  | { status: 'complete' }
  | { status: 'error'; message: string }

type FormatFilter = 'all' | 'mp4' | 'webm' | 'mkv' | 'audio'

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

function formatViews(n: number): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const FORMAT_TAG_COLORS: Record<string, string> = {
  mp4:  'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
  webm: 'bg-teal-500/20 text-teal-300 border border-teal-500/30',
  mkv:  'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  m4a:  'bg-purple-500/20 text-purple-300 border border-purple-500/30',
  mp3:  'bg-pink-500/20 text-pink-300 border border-pink-500/30',
  opus: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30',
}

function ExtTag({ ext }: { ext: string }) {
  const cls = FORMAT_TAG_COLORS[ext.toLowerCase()] ?? 'bg-white/10 text-gray-300 border border-white/15'
  return (
    <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase ${cls}`}>
      {ext.toUpperCase()}
    </span>
  )
}

function QualityBadge({ label }: { label?: string }) {
  if (!label) return null
  const isBest = label === 'best'
  const isRec  = label === 'recommended'
  if (isBest) return (
    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/25 whitespace-nowrap">
      ★ Best
    </span>
  )
  if (isRec) return (
    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 whitespace-nowrap">
      ★ Rec
    </span>
  )
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// InlineProgress — expands below the row while/after downloading
// ─────────────────────────────────────────────────────────────────────────────

function InlineProgress({ progress }: { progress: ProgressData }) {
  const { status, percent, speed, eta, downloaded_fmt, total_fmt } = progress
  const isComplete = status === 'complete'
  const isMerging  = status === 'merging'
  const isError    = status === 'error'
  const displayPct = isComplete ? 100 : percent

  return (
    <div className="space-y-1.5">
      {/* Bar */}
      {!isError && (
        <div className="relative h-1.5 rounded-full bg-white/6 overflow-hidden">
          {isMerging ? (
            <div className="absolute inset-y-0 w-1/2 rounded-full bg-gradient-to-r from-purple-500/0 via-purple-400 to-purple-500/0 animate-[slide_1.5s_ease-in-out_infinite]" />
          ) : (
            <div
              className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                isComplete ? 'bg-emerald-500' : 'bg-gradient-to-r from-indigo-500 to-sky-400'
              }`}
              style={{ width: `${displayPct}%` }}
            />
          )}
        </div>
      )}
      {/* Stats */}
      <div className="flex items-center gap-3 text-[11px] flex-wrap">
        {isComplete ? (
          <span className="flex items-center gap-1 text-emerald-400 font-semibold">
            <CheckCircle2 className="w-3 h-3" /> Saved to downloads
          </span>
        ) : isError ? (
          <span className="flex items-center gap-1 text-red-400">
            <AlertCircle className="w-3 h-3" /> {progress.error || 'Download failed'}
          </span>
        ) : isMerging ? (
          <span className="flex items-center gap-1 text-purple-400">
            <Loader2 className="w-3 h-3 animate-spin" /> Merging tracks…
          </span>
        ) : (
          <>
            <span className="text-gray-400 font-medium">{displayPct}%</span>
            <span className="text-gray-500">{speed}</span>
            <span className="text-gray-500">ETA {eta}</span>
            <span className="text-gray-600">{downloaded_fmt} / {total_fmt}</span>
          </>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FormatRow — responsive: card on mobile, table row on sm+
// ─────────────────────────────────────────────────────────────────────────────

function FormatRow({
  fmt, dlState, onDownload, locked, qualityBadge,
}: {
  fmt:           VideoFormat
  dlState:       FormatDlState
  onDownload:    (f: VideoFormat) => void
  locked:        boolean
  qualityBadge?: string
}) {
  const isActive   = dlState.status === 'active'
  const isComplete = dlState.status === 'complete'
  const isError    = dlState.status === 'error'
  const isDisabled = isActive || (locked && !isComplete && !isError)
  const progress   = isActive ? dlState.progress : null

  // Download button — shared between mobile card + desktop row
  const DownloadBtn = () => (
    isActive ? (
      <div className="flex items-center gap-1.5 text-indigo-400 text-xs font-medium whitespace-nowrap">
        <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
        <span>{progress?.percent ?? 0}%</span>
      </div>
    ) : isComplete ? (
      <div className="flex items-center gap-1 text-emerald-400 text-xs font-semibold whitespace-nowrap">
        <CircleCheck className="w-4 h-4 flex-shrink-0" /> Done
      </div>
    ) : isError ? (
      <button
        onClick={() => onDownload(fmt)}
        className="flex items-center gap-1 text-xs font-semibold text-red-400 hover:text-red-300 transition-colors whitespace-nowrap"
      >
        <RefreshCw className="w-3.5 h-3.5 flex-shrink-0" /> Retry
      </button>
    ) : (
      <button
        onClick={() => !isDisabled && onDownload(fmt)}
        disabled={isDisabled}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap ${
          locked
            ? 'bg-white/5 text-gray-600 cursor-not-allowed'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-900/30 cursor-pointer active:scale-95'
        }`}
      >
        <Download className="w-3 h-3 flex-shrink-0" />
        Download
      </button>
    )
  )

  const rowBg = isActive ? 'bg-indigo-500/5' : isComplete ? 'bg-emerald-500/4' : isError ? 'bg-red-500/4' : 'hover:bg-white/3'

  return (
    <div className={`group transition-colors duration-150 ${rowBg}`}>

      {/* ── Mobile card layout (< sm) ── */}
      <div className="sm:hidden flex items-center gap-3 px-3 py-3">
        <ExtTag ext={fmt.ext} />
        <div className="flex-1 min-w-0">
          <p className={`text-[13px] font-semibold truncate leading-tight ${
            isComplete ? 'text-emerald-300' : isError ? 'text-red-300' : 'text-white'
          }`}>
            {fmt.label}
          </p>
          <p className="text-[11px] text-gray-600 mt-0.5">
            {fmt.resolution || ''}{fmt.resolution && fmt.filesize_human ? ' · ' : ''}{fmt.filesize_human || ''}
          </p>
        </div>
        {/* Download button always visible on mobile */}
        <div className="flex-shrink-0">
          <DownloadBtn />
        </div>
      </div>

      {/* ── Desktop table row layout (sm+) ── */}
      <div className="hidden sm:grid grid-cols-[72px_1fr_120px_90px_80px_52px_110px] items-center gap-2 px-4 py-3">
        <div><ExtTag ext={fmt.ext} /></div>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-sm font-semibold truncate ${
            isComplete ? 'text-emerald-300' : isError ? 'text-red-300' : 'text-white'
          }`}>
            {fmt.label}
          </span>
          <QualityBadge label={qualityBadge} />
        </div>
        <div className="text-xs text-gray-500 font-mono truncate">{fmt.resolution || '—'}</div>
        <div className="text-xs text-gray-400">{fmt.filesize_human || '—'}</div>
        <div className="text-xs text-gray-500">{fmt.bitrate || '—'}</div>
        <div className="text-xs text-gray-500">{fmt.fps || '—'}</div>
        <div className="flex justify-end"><DownloadBtn /></div>
      </div>

      {/* Progress bar — spans full width on both layouts */}
      {isActive && progress && (
        <div className="px-3 sm:px-4 pb-3">
          <InlineProgress progress={progress} />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FormatSection — one group per container ext (MP4, WebM, …)
// ─────────────────────────────────────────────────────────────────────────────

function FormatSection({
  ext, formats, dlStates, onDownload, anyActive, activeId,
}: {
  ext:        string
  formats:    VideoFormat[]
  dlStates:   Record<string, FormatDlState>
  onDownload: (f: VideoFormat) => void
  anyActive:  boolean
  activeId:   string | null
}) {
  const tagCls = FORMAT_TAG_COLORS[ext.toLowerCase()] ?? 'bg-white/10 text-gray-300 border border-white/15'

  function getBadge(fmt: VideoFormat, idx: number): string | undefined {
    if (idx !== 0) return undefined
    const res = fmt.resolution?.toLowerCase() ?? ''
    if (res.includes('3840') || res.includes('4k') || res.includes('2160')) return 'best'
    if (res.includes('2560') || res.includes('1440')) return 'recommended'
    return undefined
  }

  return (
    <div className="rounded-xl border border-white/8 overflow-hidden">
      {/* Section header */}
      <div className="flex items-center gap-3 px-3 sm:px-4 py-2.5 bg-white/2 border-b border-white/6">
        <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded text-[11px] font-bold tracking-wider uppercase ${tagCls}`}>
          {ext.toUpperCase()}
        </span>
        <span className="text-[11px] text-gray-500 font-medium">
          {formats.length} stream{formats.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Column headers — desktop only */}
      <div className="hidden sm:grid grid-cols-[72px_1fr_120px_90px_80px_52px_110px] items-center gap-2 px-4 py-2 bg-[#0d0f1a]/60 border-b border-white/5">
        {['FORMAT', 'QUALITY', 'RESOLUTION', 'FILE SIZE', 'BITRATE', 'FPS', ''].map((h, i) => (
          <div key={i} className={`text-[10px] font-bold text-gray-600 uppercase tracking-widest ${i === 6 ? 'text-right' : ''}`}>
            {h}
          </div>
        ))}
      </div>

      <div className="divide-y divide-white/4">
        {formats.map((fmt, idx) => (
          <FormatRow
            key={fmt.format_id}
            fmt={fmt}
            dlState={dlStates[fmt.format_id] ?? { status: 'idle' }}
            onDownload={onDownload}
            locked={anyActive && activeId !== fmt.format_id}
            qualityBadge={getBadge(fmt, idx)}
          />
        ))}
      </div>
    </div>
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
  const [filter,     setFilter]     = useState<FormatFilter>('all')

  const [dlStates,       setDlStates]       = useState<Record<string, FormatDlState>>({})
  const [activeId,       setActiveId]       = useState<string | null>(null)
  const [activeProgress, setActiveProgress] = useState<ProgressData | null>(null)
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
    setFilter('all')
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
    } catch { /* clipboard denied */ }
  }

  const handleDownload = useCallback((fmt: VideoFormat) => {
    if (activeId !== null) return
    const fmtId  = fmt.format_id
    const base   = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    const sseUrl = `${base}/download/progress?url=${encodeURIComponent(url.trim())}&format_id=${fmtId}&identifier=${encodeURIComponent(identifier)}&ext=${fmt.ext}`

    const initProgress: ProgressData = {
      status: 'starting', percent: 0, speed: '0 KB/s', eta: '--:--',
      downloaded_fmt: '0 KB', total_fmt: '?', downloaded: 0, total: null,
    }
    setActiveId(fmtId)
    setFmtState(fmtId, { status: 'active', progress: initProgress })
    setActiveProgress(initProgress)

    const es = new EventSource(sseUrl)
    sseRef.current = es

    es.onmessage = (ev) => {
      let data: ProgressData
      try { data = JSON.parse(ev.data) } catch { return }

      setActiveProgress(data)
      setFmtState(fmtId, { status: 'active', progress: data })

      if (data.status === 'complete' && data.token) {
        es.close(); sseRef.current = null
        const fileUrl = `${base}/download/file?token=${data.token}`
        const a = document.createElement('a')
        a.href = fileUrl; a.download = ''
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        setFmtState(fmtId, { status: 'complete' })
        setActiveProgress({ ...data, status: 'complete', percent: 100 })
        setActiveId(null)  // re-enable all other buttons
      }

      if (data.status === 'error') {
        es.close(); sseRef.current = null
        setFmtState(fmtId, { status: 'error', message: data.error || 'Download failed.' })
        setActiveProgress(data)
        setActiveId(null)
      }
    }

    es.onerror = () => {
      es.close(); sseRef.current = null
      const msg = 'Connection lost. Please try again.'
      setFmtState(fmtId, { status: 'error', message: msg })
      setActiveProgress(prev => prev ? { ...prev, status: 'error', error: msg } : null)
      setActiveId(null)
    }
  }, [activeId, url, identifier])

  function handleReset() {
    sseRef.current?.close()
    setUrl(''); setVideoInfo(null); setFetchError('')
    setDlStates({}); setActiveId(null); setActiveProgress(null)
    setFilter('all')
  }

  // Group formats by extension
  const allFormats = videoInfo?.formats ?? []
  const videoExts  = ['mp4', 'webm', 'mkv', 'mov', 'avi']

  const grouped = allFormats.reduce<Record<string, VideoFormat[]>>((acc, f) => {
    const key = f.ext.toLowerCase()
    if (!acc[key]) acc[key] = []
    acc[key].push(f)
    return acc
  }, {})

  const sortedExts = Object.keys(grouped).sort((a, b) => {
    const ai = videoExts.indexOf(a), bi = videoExts.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
  })

  const hasAudio = sortedExts.some(e => !videoExts.includes(e))

  const filteredExts = filter === 'all'
    ? sortedExts
    : filter === 'audio'
    ? sortedExts.filter(e => !videoExts.includes(e))
    : sortedExts.filter(e => e === filter)

  const totalStreams = allFormats.length
  const anyActive   = activeId !== null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-[#0d0f1a] text-white">

      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[350px] rounded-full bg-indigo-600/4 blur-[140px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[300px] rounded-full bg-sky-600/3 blur-[120px]" />
      </div>

      {/* Navbar — passes user name + logout handler; no overlay needed */}
      <Navbar userName={name} onSignOut={handleLogout} />

      <main className="relative z-10 flex-1 w-full max-w-7xl mx-auto px-4 sm:px-8 py-6 sm:py-10">

        {/* Page heading */}
        <div className="mb-5 sm:mb-7">
          <p className="text-[10px] sm:text-[11px] font-bold text-indigo-400/80 uppercase tracking-widest mb-1">
            Processing Engine — v2.4.1
          </p>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h1 className="text-xl sm:text-3xl font-bold text-white tracking-tight">
              Video Analysis Workspace
            </h1>
            {videoInfo && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                {totalStreams} streams resolved
              </div>
            )}
          </div>
        </div>

        {/* ── URL bar ── */}
        <form onSubmit={handleFetch} className="mb-6 sm:mb-8">
          <div className="flex gap-2 items-center">
            <div className="relative flex-1 min-w-0">
              <Link2 className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-600 pointer-events-none" />
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://youtu.be/…"
                className="w-full bg-[#131627] border border-white/8 rounded-xl pl-9 sm:pl-11 pr-8 py-3 sm:py-3.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
                disabled={fetching}
                autoComplete="off"
                spellCheck={false}
              />
              {url && (
                <button type="button" onClick={() => setUrl('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors p-0.5">
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Paste — icon only on mobile, icon+text on sm+ */}
            <button
              type="button" onClick={handlePaste} disabled={fetching}
              className="flex items-center gap-1.5 py-3 px-3 sm:px-4 rounded-xl border border-white/10
                         text-gray-400 hover:text-white hover:border-white/20 bg-white/3 hover:bg-white/5
                         transition-all flex-shrink-0 disabled:opacity-40"
              title="Paste URL"
            >
              <Clipboard className="w-4 h-4 flex-shrink-0" />
              <span className="hidden sm:inline text-sm">Paste</span>
            </button>

            {/* Analyze — icon only on mobile, icon+text on sm+ */}
            <button
              type="submit" disabled={fetching || !url.trim()}
              className="flex items-center gap-1.5 py-3 px-3 sm:px-5 rounded-xl text-sm font-semibold
                         bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed
                         text-white transition-all flex-shrink-0 shadow-lg shadow-indigo-900/30"
            >
              {fetching
                ? <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                : <Play   className="w-4 h-4 fill-current flex-shrink-0" />
              }
              <span className="hidden sm:inline">{fetching ? 'Analyzing…' : 'Analyze'}</span>
            </button>
          </div>

          {fetchError && (
            <div className="flex items-start gap-2.5 mt-3 bg-red-500/8 border border-red-500/20 text-red-400 text-xs rounded-xl px-4 py-3">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{fetchError}</span>
            </div>
          )}
        </form>

        {/* ── Fetching spinner ── */}
        {fetching && (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
            <div className="relative w-20 h-20">
              <svg className="absolute inset-0 w-20 h-20 animate-spin" style={{ animationDuration: '3s' }} viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="36" fill="none" strokeWidth="2" className="stroke-white/6" />
                <circle cx="40" cy="40" r="36" fill="none" strokeWidth="2" strokeLinecap="round"
                  strokeDasharray="56 170" className="stroke-indigo-500/70" />
              </svg>
              <svg className="absolute inset-0 w-20 h-20 animate-spin"
                style={{ animationDuration: '1.8s', animationDirection: 'reverse' }} viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="26" fill="none" strokeWidth="2" className="stroke-white/4" />
                <circle cx="40" cy="40" r="26" fill="none" strokeWidth="2" strokeLinecap="round"
                  strokeDasharray="30 133" className="stroke-sky-400/60" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
                  <Film className="w-5 h-5 text-indigo-400" />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-white">Analyzing stream…</p>
              <p className="text-xs text-gray-600">Fetching formats, resolutions &amp; metadata</p>
            </div>
            <div className="flex items-end gap-1 h-8">
              {[40, 65, 50, 80, 55, 70, 45, 60, 75, 50].map((h, i) => (
                <div key={i} className="w-1.5 rounded-full bg-indigo-500/40"
                  style={{ height: `${h}%`, animation: `dlbar 1.2s ease-in-out ${i * 0.1}s infinite alternate` }} />
              ))}
            </div>
            <style>{`
              @keyframes dlbar {
                from { opacity: 0.3; transform: scaleY(0.6); }
                to   { opacity: 1;   transform: scaleY(1);   }
              }
            `}</style>
          </div>
        )}

        {/* ── Main content ── */}
        {videoInfo && !fetching && (
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">

            {/* ── LEFT: Thumbnail + Metadata ── */}
            <div className="space-y-4">
              {/* Thumbnail */}
              <div className="relative rounded-xl overflow-hidden bg-white/4 aspect-video">
                {videoInfo.thumbnail ? (
                  <img src={videoInfo.thumbnail} alt={videoInfo.title}
                    className="w-full h-full object-cover"
                    onError={e => { e.currentTarget.style.display = 'none' }} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Film className="w-10 h-10 text-white/20" />
                  </div>
                )}
                {videoInfo.duration > 0 && (
                  <div className="absolute bottom-2 right-2 bg-black/75 backdrop-blur-sm text-white text-xs font-bold px-2 py-1 rounded-lg font-mono">
                    {formatDuration(videoInfo.duration)}
                  </div>
                )}
              </div>

              {/* Title + uploader */}
              <div>
                <h2 className="text-sm font-semibold text-white leading-snug line-clamp-3">
                  {videoInfo.title}
                </h2>
                {videoInfo.uploader && (
                  <p className="text-xs text-sky-400 mt-1.5 font-medium">{videoInfo.uploader}</p>
                )}
              </div>

              {/* Metadata inspector */}
              <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
                <div className="px-4 py-2 border-b border-white/6">
                  <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Metadata Inspector</p>
                </div>
                <div className="divide-y divide-white/4">
                  {([
                    videoInfo.duration   && { icon: <Clock     className="w-3.5 h-3.5" />, label: 'Duration',  value: formatDuration(videoInfo.duration),   accent: 'text-sky-400'     },
                    videoInfo.view_count && { icon: <Eye       className="w-3.5 h-3.5" />, label: 'Views',     value: formatViews(videoInfo.view_count),     accent: 'text-sky-400'     },
                    videoInfo.like_count && { icon: <ThumbsUp  className="w-3.5 h-3.5" />, label: 'Likes',     value: formatViews(videoInfo.like_count),     accent: 'text-emerald-400' },
                    videoInfo.upload_date && { icon: <Calendar className="w-3.5 h-3.5" />, label: 'Uploaded',  value: videoInfo.upload_date,                 accent: 'text-gray-300'    },
                    videoInfo.platform   && { icon: <Globe     className="w-3.5 h-3.5" />, label: 'Platform',  value: videoInfo.platform,                    accent: 'text-sky-400'     },
                    videoInfo.id         && { icon: <Hash      className="w-3.5 h-3.5" />, label: 'Video ID',  value: videoInfo.id,                          accent: 'text-gray-500'    },
                    { icon: <Layers      className="w-3.5 h-3.5" />, label: 'Formats',  value: `${totalStreams} available`,                  accent: 'text-indigo-400' },
                  ] as const).filter(Boolean).map((row: any, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 px-4 py-2.5">
                      <div className="flex items-center gap-2 text-gray-600">
                        {row.icon}
                        <span className="text-[11px] font-medium text-gray-500">{row.label}</span>
                      </div>
                      <span className={`text-[11px] font-semibold truncate max-w-[130px] text-right ${row.accent}`}>
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Reset */}
              <button
                onClick={handleReset}
                disabled={anyActive}
                className="w-full flex items-center justify-center gap-2 text-xs font-semibold py-2.5 px-4 rounded-xl border border-white/8 text-gray-500 hover:text-white hover:border-white/15 bg-white/2 hover:bg-white/4 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Analyze another video
              </button>
            </div>

            {/* ── RIGHT: Resolution Matrix ── */}
            <div className="space-y-4">

              {/* Header + filter tabs */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-sm font-bold text-white">Resolution Matrix</h3>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[
                    { key: 'all',   label: 'All' },
                    ...sortedExts.filter(e => videoExts.includes(e)).map(e => ({ key: e, label: e.toUpperCase() })),
                    ...(hasAudio ? [{ key: 'audio', label: 'Audio' }] : []),
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setFilter(key as FormatFilter)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                        filter === key
                          ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-900/40'
                          : 'bg-white/4 text-gray-500 hover:text-gray-300 hover:bg-white/7 border border-white/6'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <span className="text-[11px] text-gray-600 ml-1 font-mono">{totalStreams} streams</span>
                </div>
              </div>

              {/* Active download notice */}
              {anyActive && (
                <div className="flex items-center gap-2.5 text-xs text-indigo-300 bg-indigo-500/6 border border-indigo-500/15 rounded-xl px-4 py-2.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400 flex-shrink-0" />
                  Download in progress — other formats locked until complete.
                </div>
              )}

              {/* Sections */}
              {filteredExts.map(ext => (
                <FormatSection
                  key={ext}
                  ext={ext}
                  formats={grouped[ext]}
                  dlStates={dlStates}
                  onDownload={handleDownload}
                  anyActive={anyActive}
                  activeId={activeId}
                />
              ))}

              {filteredExts.length === 0 && (
                <div className="rounded-xl border border-white/6 py-12 text-center text-sm text-gray-600">
                  No {filter.toUpperCase()} streams available
                </div>
              )}

              {/* Status footer */}
              <div className="flex items-center gap-3 text-[11px] text-gray-700 pt-1 flex-wrap">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  All streams verified &amp; available
                </span>
                <span>·</span>
                <span>cache-hit: true · ttl: 3600s · engine: v2.4.1</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Empty state ── */}
        {!videoInfo && !fetching && !fetchError && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/15 flex items-center justify-center mb-5">
              <Film className="w-7 h-7 text-indigo-500/60" />
            </div>
            <p className="text-base font-semibold text-gray-400">Ready to analyze</p>
            <p className="text-sm text-gray-600 mt-1.5 max-w-sm">
              Paste any YouTube, Facebook, Instagram, or TikTok link above and hit Analyze.
            </p>
          </div>
        )}
      </main>

      <Footer />
    </div>
  )
}