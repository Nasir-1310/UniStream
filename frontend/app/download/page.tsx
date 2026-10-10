'use client'
// frontend/app/download/page.tsx
//
// The signed-in download page: paste a YouTube / Facebook / Instagram link,
// see every quality the server can fetch, and download one with live progress.
//
// Auth is the session token (useSession), sent only as a Bearer header.
// Looking up a video goes through the /api proxy. A download takes two steps:
// POST /download/ticket runs the platform, account and daily-limit checks and
// returns a single-use, 60-second ticket; the progress stream (SSE) then
// opens with that ticket, straight to FastAPI because the proxy can buffer it.
// EventSource cannot send headers, and the session token must never appear in
// a URL (proxy and access logs), hence the ticket. A finished download arrives
// as a one-time file token plus the account's updated usage, which feeds the
// quota card and the Navbar pill through the shared session cache.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { KeyRound, LogIn, MessageSquareHeart, RefreshCw } from 'lucide-react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { FeedbackDialog, type FeedbackPrefill } from '@/components/FeedbackDialog'
import { Alert, Modal, PageLoader, useToast } from '@/components/ui'
import { AnalyzingState } from '@/components/download/AnalyzingState'
import { FormatMatrix } from '@/components/download/FormatMatrix'
import { GettingStarted } from '@/components/download/GettingStarted'
import { LinkForm } from '@/components/download/LinkForm'
import { QuotaCard, resetTimeText } from '@/components/download/QuotaCard'
import { VideoSummary } from '@/components/download/VideoSummary'
import { useClock, useInAppBrowser, useOnline } from '@/components/download/hooks'
import { IDLE, extractLink, formatName, heightOf, type RowState } from '@/components/download/types'
import {
  apiErrorMessage,
  apiErrorStatus,
  createDownloadTicket,
  downloadFileUrl,
  downloadProgressUrl,
  downloadResumeUrl,
  getVideoInfo,
  hasDownloadsLeft,
  isDailyLimitError,
  parseProgressEvent,
  warmBackend,
  type DownloadProgressEvent,
  type PublicUser,
  type Usage,
  type VideoFormat,
  type VideoInfo,
} from '@/lib/api'
import { clearSession, getCachedUser, getToken, refreshSession, useSession } from '@/lib/auth'
import { countBn } from '@/lib/format'
import { bnError, translateServerText } from '@/lib/serverText'
import { validateVideoUrl, type Platform } from '@/lib/validation'

/** The API's message for an expired or revoked session, as the page shows it (in Bangla). */
const SESSION_EXPIRED_TEXT = translateServerText('Your session has expired. Please sign in again.')
/** The stream's refusal of a spent or expired ticket ("This download link has expired…"). */
const TICKET_EXPIRED_RE = /download link has expired|ডাউনলোড লিংকের মেয়াদ শেষ/i
/** Show the "server is waking up" hint after this long. */
const SLOW_ANALYSIS_MS = 8000
/** Reconnect attempts after a dropped progress stream (the server keeps the download for 10 minutes). */
const MAX_RECONNECTS = 8
/** The server's refusal of a download it no longer has (older servers sent it with code "auth"). */
const JOB_GONE_RE = /interrupted for too long|stopped while the page was away|ডাউনলোড থেমে গেছে/i
const RECONNECT_DELAY_MS = 2000

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
  if (remaining <= 0) return 'এটাই ছিল আজকের শেষ ডাউনলোড।'
  return `আজ আরও ${countBn(remaining, 'ডাউনলোড')} বাকি।`
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
        <Alert tone="danger" title="আপনার অ্যাকাউন্ট লোড করা যায়নি">
          {error}
        </Alert>
        <button type="button" onClick={() => refresh().catch(() => undefined)} className="btn-primary w-full mt-4">
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          আবার চেষ্টা করুন
        </button>
      </div>
    )
  } else {
    content = <PageLoader label="আপনার অ্যাকাউন্ট লোড হচ্ছে…" />
  }

  return (
    <div className="min-h-svh flex flex-col page-bg text-white">
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
  /** Platform of the link being looked up (YouTube takes longer: sets the progress estimate). */
  const [analyzingPlatform, setAnalyzingPlatform] = useState<Platform | null>(null)
  const [slow, setSlow] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  /** True once the server is actually downloading (the stream is open), not while the ticket is fetched. */
  const [streaming, setStreaming] = useState(false)
  const [limitNotice, setLimitNotice] = useState<string | null>(null)
  const [authIssue, setAuthIssue] = useState<string | null>(null)
  const [hideTempNotice, setHideTempNotice] = useState(false)
  const [hideInAppNotice, setHideInAppNotice] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  /** Open "Report a problem / feedback" dialog, with what it should start from. */
  const [feedback, setFeedback] = useState<FeedbackPrefill | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const analysisRef = useRef<AbortController | null>(null)
  /** The pending POST /download/ticket, so Cancel (or leaving) can abort it. */
  const ticketRef = useRef<AbortController | null>(null)
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

  // Leaving the page ends the lookup, the ticket request and the stream; the
  // server then drops the unfinished download without counting it.
  useEffect(() => {
    return () => {
      analysisRef.current?.abort()
      ticketRef.current?.abort()
      streamRef.current?.close()
    }
  }, [])

  // Closing or reloading the tab mid-download cancels it, so ask first. Not
  // while the ticket is being fetched: nothing is lost then, and a 401 there
  // redirects to sign-in, which must not trigger a "Leave site?" prompt.
  useEffect(() => {
    if (!streaming) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [streaming])

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
      setUrlError(bnError(check.error))
      inputRef.current?.focus()
      return
    }
    if (!online) {
      setUrlError('আপনি অফলাইনে আছেন। ইন্টারনেটে যুক্ত হয়ে আবার চেষ্টা করুন।')
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
    setAnalyzingPlatform(check.platform ?? null)
    setAnalyzing(true)
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_ANALYSIS_MS)

    try {
      const info = await getVideoInfo(check.value, { signal: controller.signal })
      if (analysisRef.current !== controller) return
      setResult({ info, url: check.value, platform: check.platform ?? null })
      setAnnouncement(
        info.formats.length
          ? `${info.title || 'এই ভিডিও'}-এর জন্য ${countBn(info.formats.length, 'ডাউনলোড অপশন')} পাওয়া গেছে।`
          : 'এই লিংকে ডাউনলোড করার মতো কিছু নেই।',
      )
    } catch (err) {
      if (controller.signal.aborted || analysisRef.current !== controller) return
      setUrlError(apiErrorMessage(err, 'ভিডিওটি আনা যায়নি। লিংকটি দেখে আবার চেষ্টা করুন।'))
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
    setAnnouncement('ভিডিও খোঁজা বন্ধ করা হয়েছে।')
  }

  async function pasteFromClipboard() {
    let text = ''
    try {
      if (!navigator.clipboard?.readText) throw new Error('Clipboard unavailable')
      text = (await navigator.clipboard.readText()).trim()
    } catch {
      toast.info('ক্লিপবোর্ড খোলা যায়নি', { description: 'লিংকের বক্সে চেপে ধরে Paste বেছে নিন।' })
      inputRef.current?.focus()
      return
    }
    if (!text) {
      toast.info('ক্লিপবোর্ড খালি', { description: 'আগে একটি ভিডিওর লিংক কপি করুন, তারপর পেস্ট চাপুন।' })
      return
    }
    const link = extractLink(text)
    setUrl(link)
    // A supported link starts straight away; anything else stays in the box with the reason.
    const check = validateVideoUrl(link)
    if (check.ok) void analyze(link)
    else setUrlError(bnError(check.error))
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

  /** Stop the ticket request or the stream, and unlock the other formats. */
  function endStream() {
    ticketRef.current?.abort()
    ticketRef.current = null
    streamRef.current?.close()
    streamRef.current = null
    activeRef.current = null
    setActiveId(null)
    setStreaming(false)
  }

  /**
   * Start a download in two steps: ask for a ticket (the server checks the
   * link, the account and today's limit, and answers with a normal HTTP
   * error the page can show), then open the progress stream with it.
   * `isRetry` marks the single automatic retry after the stream turned down
   * its ticket.
   */
  async function startDownload(format: VideoFormat, isRetry = false) {
    const analysed = result
    if (!analysed || activeRef.current) return
    const formatId = format.format_id
    if (!online) {
      toast.error('আপনি অফলাইনে আছেন', { description: 'ইন্টারনেটে যুক্ত হয়ে আবার চেষ্টা করুন।' })
      return
    }
    // The cache can be fresher than this render (another tab finished a download).
    if (!hasDownloadsLeft(getCachedUser()?.usage ?? usage)) return
    if (!getToken()) return // signed out elsewhere; useSession is redirecting

    // Lock the list straight away: on a sleeping server the ticket can take a while.
    const controller = new AbortController()
    ticketRef.current = controller
    activeRef.current = formatId
    setActiveId(formatId)
    setLimitNotice(null)
    setRow(formatId, { status: 'active', progress: STARTING })
    if (!isRetry) setAnnouncement(`ডাউনলোড শুরু হচ্ছে: ${formatName(format)}।`)

    let ticket: string
    try {
      const issued = await createDownloadTicket(
        {
          url: analysed.url,
          format_id: formatId,
          ext: format.ext,
          height: format.type === 'video' ? heightOf(format.resolution) : null,
          source: analysed.info.source,
        },
        { signal: controller.signal },
      )
      ticket = issued.ticket
    } catch (err) {
      // Cancelled, or the page closed: endStream() has already reset the row.
      if (controller.signal.aborted) return
      endStream()
      refuseDownload(format, err)
      return
    }
    if (controller.signal.aborted) return
    ticketRef.current = null

    // Single use and valid for 60 seconds, so it is opened right away and
    // every retry asks for a new one.
    let settled = false
    let received = false
    let lastStatus = STARTING.status
    // From the first event: lets the page reconnect to the same download if
    // the stream drops (the server keeps it running for 60 seconds).
    let jobId: string | null = null
    let resumeCode: string | null = null
    let reconnects = 0

    const open = (streamUrl: string): boolean => {
      let stream: EventSource
      try {
        stream = new EventSource(streamUrl)
      } catch {
        return false
      }
      streamRef.current = stream
      setStreaming(true)

      stream.onmessage = message => {
        if (settled || streamRef.current !== stream) return
        const event = parseProgressEvent(message.data)
        if (!event) return
        received = true
        reconnects = 0
        if (event.job_id && event.resume) {
          jobId = event.job_id
          resumeCode = event.resume
        }

        if (event.status === 'complete') {
          settled = true
          endStream()
          finishDownload(format, event)
          return
        }
        if (event.status === 'error') {
          settled = true
          endStream()
          failDownload(format, event, isRetry)
          return
        }
        if (event.status !== lastStatus) {
          lastStatus = event.status
          if (event.status === 'merging') {
            setAnnouncement(format.type === 'audio' ? 'MP3-তে রূপান্তর হচ্ছে।' : 'প্রায় শেষ: ফাইল প্রস্তুত হচ্ছে।')
          } else if (event.status === 'queued') {
            setAnnouncement('অনেকে ডাউনলোড করছেন। আপনার ডাউনলোড লাইনে আছে, নিজে থেকেই শুরু হবে।')
          }
        }
        setRow(formatId, { status: 'active', progress: event })
      }

      // EventSource would reconnect on its own and replay the spent ticket,
      // so errors are handled here: reconnect to the same download with its
      // resume code a few times, and only then give up.
      stream.onerror = () => {
        if (settled || streamRef.current !== stream) return
        stream.close()
        if (jobId && resumeCode && document.visibilityState === 'hidden') {
          // A phone pauses pages in the background, which drops the stream.
          // The download keeps running on the server; reconnect when the user
          // comes back instead of spending the retries while the page sleeps.
          const resumeUrl = downloadResumeUrl(jobId, resumeCode)
          setAnnouncement('সার্ভারে ডাউনলোড চলছে। পেজে ফিরলে অগ্রগতি আবার দেখাবে।')
          const onVisible = () => {
            if (document.visibilityState !== 'visible') return
            document.removeEventListener('visibilitychange', onVisible)
            if (settled || streamRef.current !== stream) return
            if (!open(resumeUrl)) giveUp()
          }
          document.addEventListener('visibilitychange', onVisible)
          return
        }
        if (jobId && resumeCode && reconnects < MAX_RECONNECTS) {
          reconnects += 1
          const resumeUrl = downloadResumeUrl(jobId, resumeCode)
          setAnnouncement('সংযোগ বিচ্ছিন্ন। আবার যুক্ত হচ্ছে…')
          window.setTimeout(() => {
            // Cancelled, or another stream took over, while waiting.
            if (settled || streamRef.current !== stream) return
            if (!open(resumeUrl)) giveUp()
          }, RECONNECT_DELAY_MS * reconnects)
          return
        }
        giveUp()
      }
      return true
    }

    const giveUp = () => {
      if (settled) return
      settled = true
      endStream()
      const message =
        navigator.onLine === false
          ? 'আপনি অফলাইন হয়ে যাওয়ায় ডাউনলোড থেমে গেছে। ইন্টারনেটে যুক্ত হয়ে আবার চেষ্টা করুন।'
          : received
          ? 'ডাউনলোড শেষ হওয়ার আগেই সংযোগ বিচ্ছিন্ন হয়েছে। আবার চেষ্টা করুন। অসম্পূর্ণ ডাউনলোড সীমায় গোনা হয় না।'
          : 'ডাউনলোড সার্ভারে পৌঁছানো যায়নি। একটু পর আবার চেষ্টা করুন।'
      setRow(formatId, { status: 'error', message, retryable: true })
      setAnnouncement(`ডাউনলোড ব্যর্থ হয়েছে। ${message}`)
    }

    if (!open(downloadProgressUrl(ticket))) {
      endStream()
      setRow(formatId, { status: 'error', message: 'ডাউনলোড শুরু করা যায়নি। আবার চেষ্টা করুন।', retryable: true })
    }
  }

  /** The ticket request was refused (or failed): say why, next to the quality that was chosen. */
  function refuseDownload(format: VideoFormat, err: unknown) {
    const formatId = format.format_id
    const status = apiErrorStatus(err)
    const message = apiErrorMessage(err, 'ডাউনলোড শুরু করা যায়নি। আবার চেষ্টা করুন।')
    if (status === 401) {
      // lib/api has already ended the session and is taking the user to sign in.
      setRow(formatId, { status: 'error', message, retryable: false })
    } else if (status === 403) {
      // Blocked, or moved back to pending, since the page loaded.
      setAuthIssue(message)
      setRow(formatId, { status: 'error', message, retryable: false })
    } else if (isDailyLimitError(err)) {
      // Today's downloads are used up (or taken by downloads in progress), or
      // downloads are turned off for the account: the quota banner, not Retry.
      setLimitNotice(message)
      setRow(formatId, { status: 'error', message, retryable: false })
      // The server counted downloads this page doesn't know about (another tab or device).
      refresh().catch(() => undefined)
    } else {
      // 400/422: this link or quality can't be downloaded. 409: two downloads
      // already running. 429: too many attempts this hour. Network errors and
      // 5xx: worth another try.
      setRow(formatId, { status: 'error', message, retryable: status !== 400 && status !== 422 })
    }
    setAnnouncement(`ডাউনলোড শুরু হয়নি। ${message}`)
  }

  function finishDownload(format: VideoFormat, event: DownloadProgressEvent) {
    const formatId = format.format_id
    if (!event.token) {
      setRow(formatId, { status: 'error', message: 'ফাইল প্রস্তুত হয়নি। আবার চেষ্টা করুন।', retryable: true })
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
    toast.success('ডাউনলোড সম্পূর্ণ', {
      description: `আপনার ডিভাইসে সেভ হয়েছে।${left ? ` ${left}` : ''}`,
    })
    setAnnouncement(`ডাউনলোড সম্পূর্ণ: ${formatName(format)}। ${left}`)
  }

  function failDownload(format: VideoFormat, event: DownloadProgressEvent, isRetry: boolean) {
    const formatId = format.format_id
    // The stream's messages come from the API in English: shown in Bangla.
    const message = translateServerText(event.error?.trim()) || 'ডাউনলোড ব্যর্থ হয়েছে। আবার চেষ্টা করুন।'
    if (event.code === 'gone' || (event.code === 'auth' && JOB_GONE_RE.test(`${event.error ?? ''} ${message}`))) {
      // The server no longer has this download (left too long, or it
      // restarted). Nothing is wrong with the account: offer Retry, never
      // sign-out, and don't silently start a long download over again.
      setRow(formatId, {
        status: 'error',
        message: 'ডাউনলোড শেষ হওয়ার আগেই থেমে গেছে (পেজটি দীর্ঘক্ষণ বন্ধ ছিল, বা সার্ভার রিস্টার্ট হয়েছে)। এটি সীমায় গোনা হয়নি। আবার চেষ্টা করুন।',
        retryable: true,
      })
      setAnnouncement('ডাউনলোড ব্যর্থ হয়েছে। আবার চেষ্টা করুন।')
      return
    }
    switch (event.code) {
      case 'auth':
        if (!isRetry) {
          // Usually the ticket ran out before the stream opened (a slow
          // connection). A fresh ticket fixes that; if the session or the
          // account is the real problem, the ticket request says so instead.
          void startDownload(format, true)
          return
        }
        if (TICKET_EXPIRED_RE.test(message)) {
          setRow(formatId, { status: 'error', message, retryable: true })
        } else {
          // Expired session, password changed elsewhere, or the account was blocked.
          setAuthIssue(message)
          setRow(formatId, { status: 'error', message, retryable: false })
        }
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
    setAnnouncement(`ডাউনলোড ব্যর্থ হয়েছে। ${message}`)
  }

  function cancelDownload() {
    const formatId = activeRef.current
    if (!formatId) return
    endStream()
    setRow(formatId, IDLE)
    toast.info('ডাউনলোড বাতিল হয়েছে', { description: 'এটি আজকের সীমায় গোনা হয়নি।' })
    setAnnouncement('ডাউনলোড বাতিল হয়েছে।')
  }

  /** "Report this problem" on a failed download: the link, quality and error go along. */
  function reportProblem(format: VideoFormat, message: string) {
    const analysed = result
    setFeedback({
      kind: 'problem',
      url: analysed?.url,
      details: [
        `Quality: ${formatName(format)}`,
        analysed?.platform ? `Platform: ${analysed.platform}` : null,
        analysed?.info.title ? `Video: ${analysed.info.title}` : null,
        `Error: ${message}`,
      ]
        .filter(Boolean)
        .join(' · '),
    })
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
    ? 'আপনি অফলাইনে আছেন। ডাউনলোড করতে ইন্টারনেটে যুক্ত হন।'
    : exhausted
    ? usage.limit === 0
      ? 'আপনার অ্যাকাউন্টে ডাউনলোড বন্ধ আছে। ভুল মনে হলে অ্যাডমিনের সাথে যোগাযোগ করুন।'
      : `আজকের সব ডাউনলোড ব্যবহার হয়ে গেছে। আবার চালু হবে ${resetTimeText(usage)}-এ।`
    : null
  const lockedReason = activeId
    ? 'একটি ডাউনলোড চলছে। আরেকটি ভিডিও আনার আগে এটি শেষ হওয়া পর্যন্ত অপেক্ষা করুন, অথবা বাতিল করুন।'
    : !online
    ? 'আপনি অফলাইনে আছেন। ভিডিও আনতে ইন্টারনেটে যুক্ত হন।'
    : null
  const sessionExpired = authIssue === SESSION_EXPIRED_TEXT

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <header className="mb-4 sm:mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {firstName && <p className="text-[13px] font-medium text-indigo-300/90">হ্যালো, {firstName}</p>}
          <h1 className="mt-0.5 text-2xl sm:text-3xl font-bold text-white">ভিডিও ডাউনলোড করুন</h1>
          <p className="mt-1.5 text-sm sm:text-[15px] leading-relaxed text-slate-400 max-w-2xl">
            YouTube, Facebook বা Instagram-এর লিংক পেস্ট করুন, 4K পর্যন্ত কোয়ালিটি বেছে নিন, আর অফলাইনে দেখার জন্য সেভ করুন।
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFeedback({ kind: 'feedback' })}
          className="btn-outline btn-sm self-start sm:self-auto whitespace-nowrap"
        >
          <MessageSquareHeart className="w-4 h-4" aria-hidden="true" />
          সমস্যা জানান / মতামত দিন
        </button>
      </header>

      <div className="space-y-3 mb-4 sm:mb-5 empty:hidden">
        {!online && (
          <Alert tone="warning" title="আপনি অফলাইনে আছেন">
            ভিডিও আনতে ও ডাউনলোড করতে ইন্টারনেটে যুক্ত হন।
          </Alert>
        )}
        {user.temp_password && !hideTempNotice && (
          <Alert
            tone="warning"
            title="আপনি অস্থায়ী পাসওয়ার্ড ব্যবহার করছেন"
            onDismiss={() => setHideTempNotice(true)}
            action={
              <Link href="/account#password" className="btn-outline btn-sm">
                <KeyRound className="w-4 h-4" aria-hidden="true" />
                নিজের পাসওয়ার্ড সেট করুন
              </Link>
            }
          >
            অনুমোদনের ইমেইলে পাওয়া পাসওয়ার্ডটি অস্থায়ী। শুধু আপনি জানেন এমন একটি পাসওয়ার্ড দিয়ে বদলে নিন।
          </Alert>
        )}
        {inAppBrowser && !hideInAppNotice && (
          <Alert tone="info" title="পেজটি Chrome বা Safari-তে খুলুন" onDismiss={() => setHideInAppNotice(true)}>
            Facebook, Messenger আর Instagram-এর ভেতরের ব্রাউজার প্রায়ই ফাইল ডাউনলোড আটকে দেয়। ⋮ বা ··· মেনু থেকে
            “Open in browser” বেছে নিন।
          </Alert>
        )}
        {limitNotice && (
          <Alert tone="warning" title="ডাউনলোড শুরু হয়নি" onDismiss={() => setLimitNotice(null)}>
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
          <AnalyzingState slow={slow} onCancel={cancelAnalysis} platform={analyzingPlatform} />
        ) : result ? (
          <>
            {result.info.notice && (
              <Alert tone="warning" className="mb-4">
                {translateServerText(result.info.notice)}
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
                onDownload={format => void startDownload(format)}
                onCancel={cancelDownload}
                onReport={reportProblem}
                blockedReason={blockedReason}
                headingRef={headingRef}
              />
            </div>
          </>
        ) : (
          <GettingStarted />
        )}
      </div>

      <FeedbackDialog
        key={feedback ? JSON.stringify(feedback) : 'closed'}
        open={feedback !== null}
        onClose={() => setFeedback(null)}
        prefill={feedback}
      />

      <Modal
        open={Boolean(authIssue)}
        onClose={() => setAuthIssue(null)}
        size="sm"
        icon={
          <span className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
            <LogIn className="w-5 h-5 text-amber-300" aria-hidden="true" />
          </span>
        }
        title={sessionExpired ? 'আবার সাইন ইন করুন' : 'ডাউনলোড করা যাচ্ছে না'}
        description={authIssue}
        footer={
          <>
            <button type="button" onClick={() => setAuthIssue(null)} className="btn-secondary">
              এখন না
            </button>
            <button type="button" onClick={goToSignIn} className="btn-primary" data-autofocus>
              <LogIn className="w-4 h-4" aria-hidden="true" />
              {sessionExpired ? 'আবার সাইন ইন করুন' : 'সাইন আউট'}
            </button>
          </>
        }
      />
    </>
  )
}
