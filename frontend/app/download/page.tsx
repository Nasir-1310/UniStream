'use client'
// frontend/app/download/page.tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getVideoInfo, VideoInfo, VideoFormat } from '@/lib/api'
import {
  Download, LogOut, Link2, Loader2, AlertCircle,
  CheckCircle2, Film, Music, Clock, User, RefreshCw,
  XCircle, Play, Clipboard, Shield
} from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDuration(seconds: number): string {
  if (!seconds) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
  if (!bytes) return ''
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

// ── Types ─────────────────────────────────────────────────────────────────────
type DownloadState =
  | { status: 'idle' }
  | { status: 'downloading'; progress: number; loaded: number; total: number; speed: string }
  | { status: 'done' }
  | { status: 'error'; message: string }

// ── Platform colour mapping ───────────────────────────────────────────────────
const PLATFORM_COLORS: Record<string, string> = {
  YouTube:   'bg-red-500/15 text-red-400 border-red-500/25',
  Facebook:  'bg-blue-500/15 text-blue-400 border-blue-500/25',
  Instagram: 'bg-pink-500/15 text-pink-400 border-pink-500/25',
  TikTok:    'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
}

function PlatformBadge({ platform }: { platform: string }) {
  const cls = PLATFORM_COLORS[platform] || 'bg-brand-500/15 text-brand-400 border-brand-500/25'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      {platform}
    </span>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DownloadPage() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [fetchError, setFetchError] = useState('')
  const [dlStates, setDlStates] = useState<Record<string, DownloadState>>({})
  const activeDownload = useRef<string | null>(null)

  useEffect(() => {
    const id = sessionStorage.getItem('us_identifier')
    const n = sessionStorage.getItem('us_name')
    if (!id) { router.push('/'); return }
    setIdentifier(id)
    setName(n || id)
  }, [router])

  function setDlState(formatId: string, state: DownloadState) {
    setDlStates(prev => ({ ...prev, [formatId]: state }))
  }

  function handleLogout() {
    sessionStorage.clear()
    router.push('/')
  }

  async function handleFetch(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setFetching(true)
    setFetchError('')
    setVideoInfo(null)
    setDlStates({})
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
    } catch {
      // clipboard access denied — fail silently
    }
  }

  const handleDownload = useCallback(async (fmt: VideoFormat) => {
    if (activeDownload.current !== null) return
    const fmtId = fmt.format_id
    activeDownload.current = fmtId
    setDlState(fmtId, { status: 'downloading', progress: 0, loaded: 0, total: 0, speed: '' })

    const backendBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    const downloadUrl = `${backendBaseUrl}/download?url=${encodeURIComponent(url.trim())}&format_id=${fmtId}&identifier=${identifier}&ext=${fmt.ext}`

    try {
      const response = await fetch(downloadUrl)
      if (!response.ok) {
        let detail = 'Download failed. Please try again.'
        try { const json = await response.json(); detail = json.detail || detail } catch {}
        throw new Error(detail)
      }

      const contentLength = response.headers.get('Content-Length')
      const total = contentLength ? parseInt(contentLength, 10) : 0

      const disposition = response.headers.get('Content-Disposition') || ''
      let fileName = `unistream_${fmt.resolution}.${fmt.ext}`
      const utf8Match = disposition.match(/filename\*=UTF-8''(.+)/)
      if (utf8Match?.[1]) fileName = decodeURIComponent(utf8Match[1])

      const reader = response.body!.getReader()
      const chunks: Uint8Array[] = []
      let loaded = 0
      let lastTime = Date.now()
      let lastLoaded = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded += value.byteLength
        const now = Date.now()
        const elapsed = now - lastTime
        let speed = ''
        if (elapsed >= 500) {
          const bps = ((loaded - lastLoaded) / elapsed) * 1000
          speed = bps > 1024 * 1024
            ? `${(bps / (1024 * 1024)).toFixed(1)} MB/s`
            : `${(bps / 1024).toFixed(0)} KB/s`
          lastTime = now
          lastLoaded = loaded
        }
        const progress = total > 0 ? Math.round((loaded / total) * 100) : 0
        setDlState(fmtId, { status: 'downloading', progress, loaded, total, speed })
      }

      const blob = new Blob(chunks, { type: 'application/octet-stream' })
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000)
      setDlState(fmtId, { status: 'done' })
    } catch (err: any) {
      setDlState(fmtId, { status: 'error', message: err.message || 'Download failed.' })
    } finally {
      activeDownload.current = null
    }
  }, [url, identifier])

  function handleReset() {
    setUrl('')
    setVideoInfo(null)
    setFetchError('')
    setDlStates({})
  }

  const videoFormats = videoInfo?.formats.filter(f => f.type === 'video') || []
  const audioFormats = videoInfo?.formats.filter(f => f.type === 'audio') || []
  const anyDownloading = activeDownload.current !== null

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0d14]">

      {/* ── Ambient glow ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px] rounded-full bg-brand-500/5 blur-[110px]" />
      </div>

      {/* ── Header ── */}
      <header className="relative z-20 sticky top-0 border-b border-white/5 bg-[#0a0d14]/90 backdrop-blur-xl px-4 sm:px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <Download className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <span className="font-bold text-white text-sm font-display tracking-tight">UniStream Saver</span>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            {/* User chip */}
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

        {/* ── Hero ── */}
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

        {/* ── URL input ── */}
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
            {/* Paste button — mobile friendly shortcut */}
            <button
              type="button"
              onClick={handlePaste}
              disabled={fetching}
              className="btn-outline flex items-center gap-1.5 text-sm px-3 flex-shrink-0 hidden sm:flex"
              title="Paste from clipboard"
            >
              <Clipboard className="w-3.5 h-3.5" />
              Paste
            </button>
            <button
              type="submit"
              className="btn-primary flex items-center gap-2 text-sm flex-shrink-0"
              disabled={fetching || !url.trim()}
            >
              {fetching
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Play className="w-4 h-4 fill-current" />
              }
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

        {/* ── Loading skeleton ── */}
        {fetching && (
          <div className="dl-card p-5 space-y-5">
            <div className="flex gap-4">
              <div className="w-28 sm:w-36 h-18 sm:h-22 rounded-xl bg-white/5 flex-shrink-0 shimmer" style={{ height: '80px' }} />
              <div className="flex-1 space-y-2.5 pt-1">
                <div className="h-4 rounded-lg bg-white/5 w-4/5 shimmer" />
                <div className="h-3 rounded-lg bg-white/5 w-1/2 shimmer" />
                <div className="h-3 rounded-lg bg-white/5 w-1/4 shimmer" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-16 rounded-xl bg-white/5 shimmer" />
              ))}
            </div>
          </div>
        )}

        {/* ── Video info + formats ── */}
        {videoInfo && !fetching && (
          <div className="space-y-4 fade-up">

            {/* Video metadata */}
            <div className="dl-card p-4 sm:p-5">
              <div className="flex gap-4 items-start">
                {videoInfo.thumbnail && (
                  <div className="flex-shrink-0">
                    <img
                      src={videoInfo.thumbnail}
                      alt={videoInfo.title}
                      className="w-28 sm:w-36 rounded-xl object-cover bg-white/5"
                      style={{ height: '80px', objectFit: 'cover' }}
                      onError={e => (e.currentTarget.style.display = 'none')}
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-white font-semibold text-sm sm:text-base leading-snug line-clamp-2 mb-2.5 font-display">
                    {videoInfo.title}
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {videoInfo.platform && <PlatformBadge platform={videoInfo.platform} />}
                    {videoInfo.uploader && (
                      <span className="flex items-center gap-1.5 text-xs text-gray-500">
                        <User className="w-3 h-3" />
                        {videoInfo.uploader}
                      </span>
                    )}
                    {videoInfo.duration > 0 && (
                      <span className="flex items-center gap-1.5 text-xs text-gray-500">
                        <Clock className="w-3 h-3" />
                        {formatDuration(videoInfo.duration)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Downloading lock notice */}
            {anyDownloading && (
              <div className="flex items-center gap-2.5 text-xs text-brand-300 bg-brand-500/10 border border-brand-500/20 rounded-xl px-4 py-3">
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
                    <FormatButton
                      key={fmt.format_id}
                      fmt={fmt}
                      dlState={dlStates[fmt.format_id] ?? { status: 'idle' }}
                      onDownload={handleDownload}
                      locked={anyDownloading && activeDownload.current !== fmt.format_id}
                    />
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
                    <FormatButton
                      key={fmt.format_id}
                      fmt={fmt}
                      dlState={dlStates[fmt.format_id] ?? { status: 'idle' }}
                      onDownload={handleDownload}
                      locked={anyDownloading && activeDownload.current !== fmt.format_id}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Reset */}
            <button
              onClick={handleReset}
              disabled={anyDownloading}
              className="btn-outline w-full flex items-center justify-center gap-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Download another video
            </button>
          </div>
        )}

        {/* ── Empty state ── */}
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

// ── FormatButton ──────────────────────────────────────────────────────────────
function FormatButton({
  fmt,
  dlState,
  onDownload,
  locked,
}: {
  fmt: VideoFormat
  dlState: DownloadState
  onDownload: (f: VideoFormat) => void
  locked: boolean
}) {
  const isDownloading = dlState.status === 'downloading'
  const isDone        = dlState.status === 'done'
  const isError       = dlState.status === 'error'
  const isDisabled    = isDownloading || locked

  const progress    = isDownloading ? dlState.progress   : 0
  const speed       = isDownloading ? dlState.speed      : ''
  const showProgress = isDownloading && dlState.total > 0

  function stateLabel(): string {
    if (isDownloading) {
      if (showProgress) return `${progress}%${speed ? ` · ${speed}` : ''}`
      return speed ? `Downloading · ${speed}` : 'Downloading…'
    }
    if (isDone)  return 'Saved to downloads'
    if (isError) return 'Failed — tap to retry'
    return `${fmt.filesize_human || ''} · ${fmt.ext.toUpperCase()}`
  }

  const baseClasses = 'relative overflow-hidden flex items-center gap-3 p-3.5 rounded-xl border transition-all duration-200 text-left w-full group'
  const stateClasses = isDone
    ? 'border-emerald-500/30 bg-emerald-500/8 cursor-default'
    : isError
    ? 'border-red-500/25 bg-red-500/6 cursor-pointer hover:border-red-500/40'
    : isDownloading
    ? 'border-brand-500/35 bg-brand-500/6 cursor-wait'
    : locked
    ? 'border-white/5 bg-white/2 opacity-35 cursor-not-allowed'
    : 'border-white/8 bg-white/2 hover:border-brand-500/35 hover:bg-brand-500/6 cursor-pointer'

  return (
    <button
      onClick={() => !isDisabled && !isDone && onDownload(fmt)}
      disabled={isDisabled}
      title={isError ? (dlState as any).message : undefined}
      className={`${baseClasses} ${stateClasses}`}
    >
      {/* Progress fill bar */}
      {isDownloading && showProgress && (
        <div
          className="absolute inset-0 bg-brand-500/10 transition-[width] duration-300 ease-out pointer-events-none"
          style={{ width: `${progress}%` }}
          aria-hidden="true"
        />
      )}

      {/* Indeterminate shimmer */}
      {isDownloading && !showProgress && (
        <div className="absolute inset-0 pointer-events-none rounded-xl overflow-hidden" aria-hidden="true">
          <div className="absolute inset-0 shimmer opacity-60" />
        </div>
      )}

      {/* Format icon */}
      <span className="relative text-2xl leading-none flex-shrink-0 select-none" aria-hidden="true">
        {fmt.icon}
      </span>

      {/* Labels */}
      <div className="relative flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate leading-tight font-display ${isDone ? 'text-emerald-300' : isError ? 'text-red-300' : 'text-white'}`}>
          {fmt.label}
        </p>
        <p className={`text-xs mt-0.5 truncate ${isDownloading ? 'text-brand-400' : isDone ? 'text-emerald-500' : isError ? 'text-red-500' : 'text-gray-500'}`}>
          {stateLabel()}
        </p>
      </div>

      {/* Right status indicator */}
      <div className="relative flex-shrink-0">
        {isDownloading ? (
          <div className="relative w-9 h-9 flex items-center justify-center">
            {showProgress ? (
              <>
                <svg className="w-9 h-9 -rotate-90 absolute" viewBox="0 0 36 36" aria-hidden="true">
                  <circle cx="18" cy="18" r="14" fill="none" strokeWidth="2.5"
                    className="stroke-white/8" />
                  <circle cx="18" cy="18" r="14" fill="none" strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 14}`}
                    strokeDashoffset={`${2 * Math.PI * 14 * (1 - progress / 100)}`}
                    className="stroke-brand-500 transition-[stroke-dashoffset] duration-300" />
                </svg>
                <span className="text-[9px] font-bold text-brand-400 leading-none relative z-10">
                  {progress}
                </span>
              </>
            ) : (
              <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
            )}
          </div>
        ) : isDone ? (
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