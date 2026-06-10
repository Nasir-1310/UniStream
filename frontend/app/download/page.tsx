'use client'
//  <frontend /app/download/page.tsx> 
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getVideoInfo, getDownloadUrl, VideoInfo, VideoFormat } from '@/lib/api'
import {
  Download, LogOut, Link2, Loader2, AlertCircle,
  CheckCircle2, Film, Music, Clock, User,
  RefreshCw, ExternalLink
} from 'lucide-react'
import app from 'next/app'

function formatDuration(seconds: number) {
  if (!seconds) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function DownloadPage() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null)

  useEffect(() => {
    const id = sessionStorage.getItem('us_identifier')
    const n  = sessionStorage.getItem('us_name')
    if (!id) { router.push('/'); return }
    setIdentifier(id)
    setName(n || id)
  }, [router])

  function handleLogout() {
    sessionStorage.clear()
    router.push('/')
  }

  async function handleFetch(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setLoading(true)
    setError('')
    setVideoInfo(null)
    setDownloadSuccess(null)
    try {
      const info = await getVideoInfo(url.trim(), identifier)
      setVideoInfo(info)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'ভিডিও তথ্য পাওয়া যায়নি। লিংক চেক করুন।')
    } finally {
      setLoading(false)
    }
  }

  async function handleDownload(fmt: VideoFormat) {
    setDownloading(fmt.format_id)
    setDownloadSuccess(null)
    try {
      const res = await getDownloadUrl(url.trim(), fmt.format_id, identifier, fmt.ext)
      // Open direct URL in new tab — browser handles download
      const a = document.createElement('a')
      a.href = res.download_url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.click()
      setDownloadSuccess(fmt.format_id)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'ডাউনলোড লিংক পাওয়া যায়নি।')
    } finally {
      setDownloading(null)
    }
  }

  function handleReset() {
    setUrl('')
    setVideoInfo(null)
    setError('')
    setDownloadSuccess(null)
  }

  const videoFormats = videoInfo?.formats.filter(f => f.type === 'video') || []
  const audioFormats = videoInfo?.formats.filter(f => f.type === 'audio') || []

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ── */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between sticky top-0 bg-surface/80 backdrop-blur z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
            <Download className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white text-sm sm:text-base">UniStream Saver</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400">
            <User className="w-3 h-3 text-brand-500" />
            <span className="text-brand-400">{name}</span>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-400 transition-colors">
            <LogOut className="w-3.5 h-3.5" /> লগআউট
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 space-y-6">
        {/* ── Welcome ── */}
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 bg-brand-500/10 border border-brand-500/20 text-brand-400 text-xs px-3 py-1 rounded-full mb-2">
            <CheckCircle2 className="w-3 h-3" /> অ্যাক্সেস অ্যাপ্রুভড
          </div>
          <h1 className="text-xl font-bold text-white">ভিডিও লিংক পেস্ট করুন</h1>
          <p className="text-gray-500 text-sm mt-1">YouTube, Facebook, Instagram বা TikTok এর যেকোনো লিংক</p>
        </div>

        {/* ── URL Input ── */}
        <form onSubmit={handleFetch} className="glass p-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="input-field pl-10 text-sm"
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              className="btn-primary px-4 flex items-center gap-2 text-sm"
              disabled={loading || !url.trim()}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
              <span className="hidden sm:inline">{loading ? 'খুঁজছি...' : 'খুঁজুন'}</span>
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}
        </form>

        {/* ── Loading shimmer ── */}
        {loading && (
          <div className="glass p-4 space-y-3">
            <div className="flex gap-3">
              <div className="w-20 h-14 rounded-lg shimmer flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 rounded shimmer w-3/4" />
                <div className="h-3 rounded shimmer w-1/2" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[1,2,3,4].map(i => <div key={i} className="h-12 rounded-lg shimmer" />)}
            </div>
          </div>
        )}

        {/* ── Video Info ── */}
        {videoInfo && !loading && (
          <div className="space-y-4">
            {/* Video Meta */}
            <div className="glass p-4">
              <div className="flex gap-3 items-start">
                {videoInfo.thumbnail && (
                  <img
                    src={videoInfo.thumbnail}
                    alt={videoInfo.title}
                    className="w-24 sm:w-32 h-16 sm:h-20 object-cover rounded-lg flex-shrink-0"
                    onError={e => (e.currentTarget.style.display = 'none')}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-white font-semibold text-sm leading-tight line-clamp-2 mb-1">
                    {videoInfo.title}
                  </h2>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                    {videoInfo.uploader && <span>👤 {videoInfo.uploader}</span>}
                    {videoInfo.duration > 0 && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatDuration(videoInfo.duration)}
                      </span>
                    )}
                    {videoInfo.platform && (
                      <span className="badge bg-brand-500/10 text-brand-400 border border-brand-500/20">
                        {videoInfo.platform}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Video Formats */}
            {videoFormats.length > 0 && (
              <div className="glass p-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5" /> ভিডিও কোয়ালিটি
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {videoFormats.map(fmt => (
                    <FormatButton
                      key={fmt.format_id}
                      fmt={fmt}
                      onDownload={handleDownload}
                      isDownloading={downloading === fmt.format_id}
                      isSuccess={downloadSuccess === fmt.format_id}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Audio Formats */}
            {audioFormats.length > 0 && (
              <div className="glass p-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Music className="w-3.5 h-3.5" /> অডিও
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {audioFormats.map(fmt => (
                    <FormatButton
                      key={fmt.format_id}
                      fmt={fmt}
                      onDownload={handleDownload}
                      isDownloading={downloading === fmt.format_id}
                      isSuccess={downloadSuccess === fmt.format_id}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Reset */}
            <button onClick={handleReset} className="btn-outline w-full flex items-center justify-center gap-2 text-sm">
              <RefreshCw className="w-3.5 h-3.5" /> আরেকটি ভিডিও ডাউনলোড করুন
            </button>
          </div>
        )}

        {/* ── Empty state hint ── */}
        {!videoInfo && !loading && !error && (
          <div className="text-center py-8 text-gray-600 text-sm">
            <div className="text-4xl mb-3">🎬</div>
            <p>উপরে ভিডিওর লিংক পেস্ট করুন</p>
            <p className="text-xs mt-1">সব প্ল্যাটফর্মের লিংক সাপোর্টেড</p>
          </div>
        )}
      </main>

      <footer className="border-t border-border px-4 py-3 text-center text-xs text-gray-700">
        UniStream Saver • শুধুমাত্র ব্যক্তিগত ব্যবহারের জন্য
      </footer>
    </div>
  )
}

function FormatButton({
  fmt, onDownload, isDownloading, isSuccess
}: {
  fmt: VideoFormat
  onDownload: (f: VideoFormat) => void
  isDownloading: boolean
  isSuccess: boolean
}) {
  return (
    <button
      onClick={() => onDownload(fmt)}
      disabled={isDownloading}
      className={`
        flex items-center justify-between p-3 rounded-lg border transition-all duration-200 text-left
        ${isSuccess
          ? 'border-brand-500/40 bg-brand-500/10'
          : 'border-border bg-surface hover:border-brand-500/40 hover:bg-brand-500/5'
        }
        disabled:opacity-60 disabled:cursor-not-allowed
      `}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-lg">{fmt.icon}</span>
        <div>
          <div className="text-white text-xs font-medium">{fmt.label}</div>
          <div className="text-gray-500 text-xs">{fmt.filesize_human} · {fmt.ext.toUpperCase()}</div>
        </div>
      </div>
      <div className="flex-shrink-0">
        {isDownloading ? (
          <Loader2 className="w-4 h-4 text-brand-500 animate-spin" />
        ) : isSuccess ? (
          <CheckCircle2 className="w-4 h-4 text-brand-500" />
        ) : (
          <Download className="w-4 h-4 text-gray-500" />
        )}
      </div>
    </button>
  )
}
