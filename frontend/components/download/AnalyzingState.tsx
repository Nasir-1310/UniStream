// components/download/AnalyzingState.tsx
//
// Progress while /video-info looks up the link. That usually takes a few
// seconds (YouTube longer), but the first request after the API has slept
// (Render free tier) can take up to a minute, so after a while the copy says
// so instead of looking stuck.
//
// The server reports no progress for a lookup, so the percentage is an
// estimate from the elapsed time and how long the platform usually takes:
// it climbs quickly, slows down as it nears the end, and never reaches 100%
// on its own. The results replace it as soon as they arrive.
//
// useAnalysisProgress() runs the estimate once; the page shows it in two
// places: AnalysisProgressInline inside the link card (always, so phones see
// it right under the link they pasted) and AnalyzingState below (wide
// screens only, where there is room for it).

import { useEffect, useState } from 'react'
import { Film, X } from 'lucide-react'
import type { Platform } from '@/lib/validation'

export interface AnalysisProgress {
  /** 0–95, whole numbers. */
  percent: number
  stage: string
}

/** Typical lookup time in seconds, per platform. */
const EXPECTED_SECONDS: Record<string, number> = { youtube: 25, facebook: 6, instagram: 6 }

const STAGES: [number, string][] = [
  [0, 'সার্ভারের সাথে সংযোগ হচ্ছে…'],
  [15, 'ভিডিওর পেজ পড়া হচ্ছে…'],
  [45, 'কোন কোন কোয়ালিটি আছে খোঁজা হচ্ছে…'],
  [80, 'প্রায় শেষ: ফাইলের সাইজ দেখা হচ্ছে…'],
]

/** 0 → 95%: about 80% at the expected time, then ever slower. */
function estimate(elapsedSeconds: number, expected: number): number {
  return 95 * (1 - Math.exp((-1.6 * elapsedSeconds) / expected))
}

/** The estimated progress of a running lookup (0% while none runs). */
export function useAnalysisProgress(active: boolean, platform: Platform | null): AnalysisProgress {
  const expected = EXPECTED_SECONDS[platform ?? ''] ?? 15
  const [percent, setPercent] = useState(0)

  useEffect(() => {
    if (!active) return
    const started = Date.now()
    const timer = window.setInterval(() => {
      setPercent(estimate((Date.now() - started) / 1000, expected))
    }, 200)
    return () => {
      window.clearInterval(timer)
      setPercent(0)
    }
  }, [active, expected])

  const shown = active ? Math.floor(percent) : 0
  const stage = STAGES.reduce((label, [from, text]) => (shown >= from ? text : label), STAGES[0][1])
  return { percent: shown, stage }
}

/** Compact bar inside the link card, right under the pasted link. */
export function AnalysisProgressInline({
  progress,
  slow,
  onCancel,
}: {
  progress: AnalysisProgress
  slow: boolean
  onCancel: () => void
}) {
  return (
    <div className="mt-3 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.06] px-3.5 py-3" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-[13px] font-semibold text-white">
          <span className="tabular-nums text-indigo-300">{progress.percent}%</span>
          <span className="mx-1.5 text-slate-500" aria-hidden="true">·</span>
          {progress.stage}
        </p>
        <button type="button" onClick={onCancel} className="btn-ghost -my-1.5 -mr-2 flex-shrink-0 text-xs">
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          বাতিল
        </button>
      </div>
      <div
        className="mt-2 h-2 rounded-full bg-white/[0.08] overflow-hidden"
        role="progressbar"
        aria-label="ভিডিও আনা হচ্ছে (আনুমানিক)"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-400 transition-[width] duration-200"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      {slow && (
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          এখনো কাজ চলছে। কিছুক্ষণ ব্যবহার না হলে সার্ভার চালু হতে এক মিনিট পর্যন্ত লাগতে পারে।
        </p>
      )}
    </div>
  )
}

export interface AnalyzingStateProps {
  progress: AnalysisProgress
  /** True once the request has run long enough to explain the wait. */
  slow: boolean
  onCancel: () => void
  /** The link's platform: YouTube lookups take longer than Facebook/Instagram ones. */
  platform?: Platform | null
}

/** The large progress card below the link card (wide screens). */
export function AnalyzingState({ progress, slow, onCancel, platform = null }: AnalyzingStateProps) {
  const shown = progress.percent

  return (
    <div className="surface-card flex flex-col items-center justify-center px-5 py-12 sm:py-16 text-center">
      <div className="relative w-20 h-20" aria-hidden="true">
        <svg className="absolute inset-0 w-20 h-20 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" fill="none" strokeWidth="3" className="stroke-white/[0.06]" />
          <circle
            cx="40"
            cy="40"
            r="36"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(2 * Math.PI * 36 * shown) / 100} ${2 * Math.PI * 36}`}
            className="stroke-indigo-400 transition-[stroke-dasharray] duration-200"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
            <Film className="w-5 h-5 text-indigo-400" />
          </div>
        </div>
      </div>

      <p className="mt-5 text-3xl font-semibold text-white tabular-nums" aria-hidden="true">
        {shown}%
      </p>

      <div className="mt-2 space-y-1.5 max-w-sm">
        <p className="text-sm font-semibold text-white">{progress.stage}</p>
        <p className="text-xs leading-relaxed text-slate-500">
          {slow
            ? 'এখনো কাজ চলছে। কিছুক্ষণ ব্যবহার না হলে সার্ভার চালু হতে এক মিনিট পর্যন্ত লাগতে পারে।'
            : platform === 'youtube'
            ? 'YouTube ভিডিওতে সাধারণত 15–30 সেকেন্ড লাগে।'
            : 'সাধারণত কয়েক সেকেন্ড লাগে।'}
        </p>
      </div>

      <div className="mt-5 h-1.5 w-full max-w-xs rounded-full bg-white/[0.08] overflow-hidden" aria-hidden="true">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-400 transition-[width] duration-200"
          style={{ width: `${shown}%` }}
        />
      </div>

      <button type="button" onClick={onCancel} className="btn-ghost mt-6">
        <X className="w-4 h-4" aria-hidden="true" />
        বাতিল
      </button>
    </div>
  )
}

export default AnalyzingState
