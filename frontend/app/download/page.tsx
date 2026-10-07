'use client'
// frontend/app/download/page.tsx
//
// The signed-in workspace: paste a YouTube / Facebook / Instagram link, see
// every quality the server can fetch, and download one with live progress.
//
// Auth is the session token (useSession). Analysis goes through the /api
// proxy; the progress stream (SSE) connects straight to FastAPI because the
// proxy can buffer it, and carries the token as a query parameter since
// EventSource cannot send headers. A finished download arrives as a one-time
// file token plus the account's updated usage, which feeds the quota card and
// the Navbar pill through the shared session cache.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { KeyRound, LogIn, RefreshCw } from 'lucide-react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { Alert, Modal, PageLoader, useToast } from '@/components/ui'
import { AnalyzingState } from '@/components/download/AnalyzingState'
import { FormatMatrix } from '@/components/download/FormatMatrix'
import { GettingStarted } from '@/components/download/GettingStarted'
import { LinkForm } from '@/components/download/LinkForm'
import { QuotaCard, resetTimeText } from '@/components/download/QuotaCard'
import { VideoSummary } from '@/components/download/VideoSummary'
import { useClock, useInAppBrowser, useOnline } from '@/components/download/hooks'
import { IDLE, extractLink, heightOf, type RowState } from '@/components/download/types'
import {
  apiErrorMessage,
  downloadFileUrl,
  downloadProgressUrl,
  getVideoInfo,
  hasDownloadsLeft,
  parseProgressEvent,
  warmBackend,
  type DownloadProgressEvent,
  type PublicUser,
  type Usage,
  type VideoFormat,
  type VideoInfo,
} from '@/lib/api'
import { clearSession, getCachedUser, getToken, refreshSession, useSession } from '@/lib/auth'
import { pluralize } from '@/lib/format'
import { validateVideoUrl, type Platform } from '@/lib/validation'

/** Matches the API's message for an expired or revoked session. */
const SESSION_EXPIRED_TEXT = 'Your session has expired. Please sign in again.'
/** Show the "server is waking up" hint after this long. */
const SLOW_ANALYSIS_MS = 8000

const STARTING: DownloadProgressEvent = {
  status: 'starting',
  percent: 0,
  speed: '',
  eta: '--:--',
  downloaded_fmt: '0 KB',
  total_fmt: '?',
  downloaded: 0,
  total: null,
}

interface AnalysisResult {
  info: VideoInfo
  /** Normalised link the formats belong to; downloads must use this, not the box's current text. */
  url: string
  platform: Platform | null
}

/** Hand the finished file to the browser's download manager. */
function saveFile(href: string): void {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = ''
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** "2 downloads left today." / "That was today's last download." / "" for unlimited. */
function remainingText(usage: Usage): string {
  if (usage.limit === null) return ''
  const remaining = usage.remaining ?? Math.max(0, usage.limit - usage.used)
  if (remaining <= 0) return 'That was today’s last download.'
  return `${pluralize(remaining, 'download')} left today.`
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

// ═════════════════════════════════════════════════════════════════════════════
// Page
// ═════════════════════════════════════════════════════════════════════════════

export default function DownloadPage() {
  const { user, loading, error, refresh, signOut, setUser } = useSession({ required: true })

  let content
  if (user) {
    content = <Workspace user={user} refresh={refresh} signOut={signOut} setUser={setUser} />
  } else if (error && !loading) {
    content = (
      <div className="max-w-md mx-auto mt-6 surface-card p-5 sm:p-6">
        <Alert tone="danger" title="We couldn’t load your account">
          {error}
        </Alert>
        <button type="button" onClick={() => refresh().catch(() => undefined)} className="btn-primary w-full mt-4">
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Try again
        </button>
      </div>
    )
  } else {
    content = <PageLoader label="Loading your workspace…" />
  }

  return (
    <div className="min-h-svh flex flex-col bg-[#0d0f1a] text-white">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] max-w-[200vw] h-[350px] rounded-full bg-indigo-600/[0.05] blur-[140px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[300px] rounded-full bg-sky-600/[0.04] blur-[120px]" />
      </div>

      <Navbar />

      <main id="main" className="relative z-10 flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
        {content}
      </main>

      <Footer />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Workspace (signed in)
// ═════════════════════════════════════════════════════════════════════════════

interface WorkspaceProps {
  user: PublicUser
  refresh: () => Promise<PublicUser | null>
  signOut: () => void
  setUser: (user: PublicUser) => void
}

function Workspace({ user, refresh, signOut, setUser }: WorkspaceProps) {
  const toast = useToast()
  const now = useClock()
  const online = useOnline()
  const inAppBrowser = useInAppBrowser()

  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [slow, setSlow] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [limitNotice, setLimitNotice] = useState<string | null>(null)
  const [authIssue, setAuthIssue] = useState<string | null>(null)
  const [hideTempNotice, setHideTempNotice] = useState(false)
  const [hideInAppNotice, setHideInAppNotice] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const analysisRef = useRef<AbortController | null>(null)
  const streamRef = useRef<EventSource | null>(null)
  /** format_id of the running download; a ref so stream callbacks see the latest value. */
  const activeRef = useRef<string | null>(null)
  /** Focus the link box once analysis ends (it is disabled while it runs). */
  const focusInputWhenIdle = useRef(false)
  const refreshedForReset = useRef<string | null>(null)

  const usage = user.usage
  const firstName = user.name?.trim().split(/\s+/)[0] ?? ''

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  // Start waking the API (Render free tier) while the user finds a link.
  useEffect(() => {
    warmBackend()
  }, [])

  // Leaving the page ends the analysis and the stream; the server then drops
  // the unfinished download without counting it.
  useEffect(() => {
    return () => {
      analysisRef.current?.abort()
      streamRef.current?.close()
    }
  }, [])

  // Closing or reloading the tab mid-download cancels it, so ask first.
  useEffect(() => {
    if (!activeId) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [activeId])

  // Coming back to the tab (perhaps after downloading on another device):
  // re-read the usage. refreshSession() is deduplicated and rate-limited.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshSession().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Past the daily reset the cached numbers are yesterday's: fetch today's once.
  const resetPassed = now > 0 && now >= Date.parse(usage.resets_at)
  useEffect(() => {
    if (!resetPassed || refreshedForReset.current === usage.resets_at) return
    refreshedForReset.current = usage.resets_at
    refresh().catch(() => undefined)
  }, [resetPassed, usage.resets_at, refresh])

  useEffect(() => {
    if (analyzing || !focusInputWhenIdle.current) return
    focusInputWhenIdle.current = false
    inputRef.current?.focus()
  }, [analyzing])

  // New results: put screen-reader focus on them, and scroll them into view
  // when they start below the fold (phones).
  useEffect(() => {
    if (!result) return
    headingRef.current?.focus({ preventScroll: true })
    const box = resultsRef.current
    if (box && box.getBoundingClientRect().top > window.innerHeight * 0.55) {
      box.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
    }
  }, [result])

  // ── Analysis ────────────────────────────────────────────────────────────────

  async function analyze(raw: string = url) {
    if (activeRef.current) return
    const check = validateVideoUrl(extractLink(raw))
    if (!check.ok) {
      setUrlError(check.error)
      inputRef.current?.focus()
      return
    }
    if (!online) {
      setUrlError('You’re offline. Reconnect to the internet and try again.')
      return
    }

    analysisRef.current?.abort()
    const controller = new AbortController()
    analysisRef.current = controller
    setUrl(check.value)
    setUrlError(null)
    setLimitNotice(null)
    setResult(null)
    setRows({})
    setSlow(false)
    setAnalyzing(true)
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_ANALYSIS_MS)

    try {
      const info = await getVideoInfo(check.value, { signal: controller.signal })
      if (analysisRef.current !== controller) return
      setResult({ info, url: check.value, platform: check.platform ?? null })
      setAnnouncement(
        info.formats.length
          ? `Found ${pluralize(info.formats.length, 'download option')} for ${info.title || 'this video'}.`
          : 'This link has nothing to download.',
      )
    } catch (err) {
      if (controller.signal.aborted || analysisRef.current !== controller) return
      setUrlError(apiErrorMessage(err, 'We couldn’t analyze this link. Check it and try again.'))
      focusInputWhenIdle.current = true
    } finally {
      window.clearTimeout(slowTimer)
      if (analysisRef.current === controller) {
        analysisRef.current = null
        setAnalyzing(false)
        setSlow(false)
      }
    }
  }

  function cancelAnalysis() {
    analysisRef.current?.abort()
    analysisRef.current = null
    setAnalyzing(false)
    setSlow(false)
    focusInputWhenIdle.current = true
    setAnnouncement('Analysis cancelled.')
  }

  async function pasteFromClipboard() {
    let text = ''
    try {
      if (!navigator.clipboard?.readText) throw new Error('Clipboard unavailable')
      text = (await navigator.clipboard.readText()).trim()
    } catch {
      toast.info('Couldn’t open your clipboard', { description: 'Long-press the link box and choose Paste instead.' })
      inputRef.current?.focus()
      return
    }
    if (!text) {
      toast.info('Your clipboard is empty', { description: 'Copy a video link first, then tap Paste.' })
      return
    }
    const link = extractLink(text)
    setUrl(link)
    // A supported link starts straight away; anything else stays in the box with the reason.
    const check = validateVideoUrl(link)
    if (check.ok) void analyze(link)
    else setUrlError(check.error)
  }

  function clearLink() {
    setUrl('')
    setUrlError(null)
    inputRef.current?.focus()
  }

  function startOver() {
    if (activeRef.current) return
    analysisRef.current?.abort()
    analysisRef.current = null
    setResult(null)
    setRows({})
    setUrl('')
    setUrlError(null)
    setLimitNotice(null)
    inputRef.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }

  // ── Downloads ───────────────────────────────────────────────────────────────

  function setRow(formatId: string, state: RowState) {
    setRows(prev => ({ ...prev, [formatId]: state }))
  }

  /** Close the stream and unlock the other formats. */
  function endStream() {
    streamRef.current?.close()
    streamRef.current = null
    activeRef.current = null
    setActiveId(null)
  }

  function startDownload(format: VideoFormat) {
    if (!result || activeRef.current) return
    const formatId = format.format_id
    if (!online) {
      toast.error('You’re offline', { description: 'Reconnect to the internet and try again.' })
      return
    }
    // The cache can be fresher than this render (another tab finished a download).
    if (!hasDownloadsLeft(getCachedUser()?.usage ?? usage)) return
    const token = getToken()
    if (!token) return // signed out elsewhere; useSession is redirecting

    let stream: EventSource
    try {
      stream = new EventSource(
        downloadProgressUrl({
          url: result.url,
          formatId,
          ext: format.ext,
          height: format.type === 'video' ? heightOf(format.resolution) : null,
          source: result.info.source,
          token,
        }),
      )
    } catch {
      setRow(formatId, { status: 'error', message: 'The download couldn’t start. Please try again.', retryable: true })
      return
    }

    streamRef.current = stream
    activeRef.current = formatId
    setActiveId(formatId)
    setLimitNotice(null)
    setRow(formatId, { status: 'active', progress: STARTING })
    setAnnouncement(`Starting download: ${format.label}.`)

    let settled = false
    let received = false
    let lastStatus = STARTING.status

    stream.onmessage = message => {
      if (settled || streamRef.current !== stream) return
      const event = parseProgressEvent(message.data)
      if (!event) return
      received = true

      if (event.status === 'complete') {
        settled = true
        endStream()
        finishDownload(format, event)
        return
      }
      if (event.status === 'error') {
        settled = true
        endStream()
        failDownload(format, event)
        return
      }
      if (event.status !== lastStatus) {
        lastStatus = event.status
        if (event.status === 'merging') {
          setAnnouncement(format.type === 'audio' ? 'Converting to MP3.' : 'Almost done: merging video and audio.')
        }
      }
      setRow(formatId, { status: 'active', progress: event })
    }

    // EventSource reconnects on its own after an error, which would start a
    // second download, so any error ends this one for good.
    stream.onerror = () => {
      if (settled || streamRef.current !== stream) return
      settled = true
      endStream()
      const message =
        navigator.onLine === false
          ? 'You went offline, so the download stopped. Reconnect and try again.'
          : received
          ? 'The connection dropped before the download finished. Please try again. Interrupted downloads don’t count toward your limit.'
          : 'We couldn’t reach the download server. Please try again in a moment.'
      setRow(formatId, { status: 'error', message, retryable: true })
      setAnnouncement(`Download failed. ${message}`)
    }
  }

  function finishDownload(format: VideoFormat, event: DownloadProgressEvent) {
    const formatId = format.format_id
    if (!event.token) {
      setRow(formatId, { status: 'error', message: 'The file wasn’t ready. Please try again.', retryable: true })
      return
    }
    saveFile(downloadFileUrl(event.token))
    setRow(formatId, { status: 'complete' })

    if (event.usage) {
      // Read the cache, not this render's `user`: it may have been refreshed meanwhile.
      const latest = getCachedUser()
      if (latest) setUser({ ...latest, usage: event.usage })
    }
    const left = event.usage ? remainingText(event.usage) : ''
    toast.success('Download complete', {
      description: `Saved to your device.${left ? ` ${left}` : ''}`,
    })
    setAnnouncement(`Download complete: ${format.label}. ${left}`)
  }

  function failDownload(format: VideoFormat, event: DownloadProgressEvent) {
    const formatId = format.format_id
    const message = event.error?.trim() || 'The download failed. Please try again.'
    switch (event.code) {
      case 'auth':
        // Expired session, password changed elsewhere, or the account was blocked.
        setAuthIssue(message)
        setRow(formatId, { status: 'error', message, retryable: false })
        break
      case 'limit':
        setLimitNotice(message)
        setRow(formatId, { status: 'error', message, retryable: false })
        // The server counted something this page doesn't know about yet.
        refresh().catch(() => undefined)
        break
      case 'platform':
        setRow(formatId, { status: 'error', message, retryable: false })
        break
      default:
        // 'busy' (two downloads already running, or the server is full) and
        // ordinary failures: worth another try.
        setRow(formatId, { status: 'error', message, retryable: true })
    }
    setAnnouncement(`Download failed. ${message}`)
  }

  function cancelDownload() {
    const formatId = activeRef.current
    if (!formatId) return
    endStream()
    setRow(formatId, IDLE)
    toast.info('Download cancelled', { description: 'It didn’t count toward today’s limit.' })
    setAnnouncement('Download cancelled.')
  }

  function goToSignIn() {
    const expired = authIssue === SESSION_EXPIRED_TEXT
    setAuthIssue(null)
    if (expired) {
      // useSession({ required: true }) sends us to /?session=expired.
      clearSession({ expired: true })
    } else {
      signOut()
    }
  }

  // ── Derived state ───────────────────────────────────────────────────────────

  const exhausted = !hasDownloadsLeft(usage)
  const blockedReason = !online
    ? 'You’re offline. Reconnect to the internet to download.'
    : exhausted
    ? usage.limit === 0
      ? 'Downloads are paused for your account. Contact the administrator if this is a mistake.'
      : `You’ve used all of today’s downloads. More unlock at ${resetTimeText(usage)}.`
    : null
  const lockedReason = activeId
    ? 'A download is running. Wait for it to finish, or cancel it, before analyzing another link.'
    : !online
    ? 'You’re offline. Reconnect to analyze links.'
    : null
  const sessionExpired = authIssue === SESSION_EXPIRED_TEXT

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <header className="mb-4 sm:mb-6">
        {firstName && <p className="text-[13px] font-medium text-indigo-300/90">Hi, {firstName}</p>}
        <h1 className="mt-0.5 text-2xl sm:text-3xl font-bold text-white">Download a video</h1>
        <p className="mt-1.5 text-sm sm:text-[15px] leading-relaxed text-slate-400 max-w-2xl">
          Paste a YouTube, Facebook or Instagram link, choose a quality, and save it for offline viewing.
        </p>
      </header>

      <div className="space-y-3 mb-4 sm:mb-5 empty:hidden">
        {!online && (
          <Alert tone="warning" title="You’re offline">
            Reconnect to the internet to analyze links and download.
          </Alert>
        )}
        {user.temp_password && !hideTempNotice && (
          <Alert
            tone="warning"
            title="You’re using a temporary password"
            onDismiss={() => setHideTempNotice(true)}
            action={
              <Link href="/account#password" className="btn-outline btn-sm">
                <KeyRound className="w-4 h-4" aria-hidden="true" />
                Set my own password
              </Link>
            }
          >
            The password from your approval email is temporary. Replace it with one only you know.
          </Alert>
        )}
        {inAppBrowser && !hideInAppNotice && (
          <Alert tone="info" title="Open this page in Chrome or Safari" onDismiss={() => setHideInAppNotice(true)}>
            Browsers built into Facebook, Messenger and Instagram often block file downloads. Tap the ⋮ or ··· menu and
            choose “Open in browser”.
          </Alert>
        )}
        {limitNotice && (
          <Alert tone="warning" title="Download not started" onDismiss={() => setLimitNotice(null)}>
            {limitNotice}
          </Alert>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <LinkForm
          ref={inputRef}
          value={url}
          onChange={value => {
            setUrl(value)
            if (urlError) setUrlError(null)
          }}
          onSubmit={() => void analyze()}
          onPaste={() => void pasteFromClipboard()}
          onClear={clearLink}
          error={urlError}
          analyzing={analyzing}
          lockedReason={lockedReason}
        />
        <QuotaCard usage={usage} now={now} />
      </div>

      <div ref={resultsRef} className="mt-5 sm:mt-6 scroll-mt-20">
        {analyzing ? (
          <AnalyzingState slow={slow} onCancel={cancelAnalysis} />
        ) : result ? (
          <>
            {result.info.notice && (
              <Alert tone="warning" className="mb-4">
                {result.info.notice}
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-6 lg:items-start">
              <div className="lg:sticky lg:top-20">
                <VideoSummary
                  info={result.info}
                  platform={result.platform}
                  url={result.url}
                  onReset={startOver}
                  resetDisabled={Boolean(activeId)}
                />
              </div>
              <FormatMatrix
                key={result.url}
                formats={result.info.formats ?? []}
                rows={rows}
                activeId={activeId}
                onDownload={startDownload}
                onCancel={cancelDownload}
                blockedReason={blockedReason}
                headingRef={headingRef}
              />
            </div>
          </>
        ) : (
          <GettingStarted />
        )}
      </div>

      <Modal
        open={Boolean(authIssue)}
        onClose={() => setAuthIssue(null)}
        size="sm"
        icon={
          <span className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
            <LogIn className="w-5 h-5 text-amber-300" aria-hidden="true" />
          </span>
        }
        title={sessionExpired ? 'Please sign in again' : 'Downloads aren’t available'}
        description={authIssue}
        footer={
          <>
            <button type="button" onClick={() => setAuthIssue(null)} className="btn-secondary">
              Not now
            </button>
            <button type="button" onClick={goToSignIn} className="btn-primary" data-autofocus>
              <LogIn className="w-4 h-4" aria-hidden="true" />
              {sessionExpired ? 'Sign in again' : 'Sign out'}
            </button>
          </>
        }
      />
    </>
  )
}
