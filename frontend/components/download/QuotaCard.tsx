'use client'
// components/download/QuotaCard.tsx
//
// Today's allowance at the top of the download page: how many downloads are
// left, when the count resets (in the app's timezone, not the browser's), and
// an "Unlimited" badge for accounts without a limit.

import type { ReactNode } from 'react'
import { Download, Infinity as InfinityIcon } from 'lucide-react'
import { Badge } from '@/components/ui'
import type { Usage } from '@/lib/api'
import { countBn, formatNumber, formatTime, formatTimeUntilBn, usagePercent } from '@/lib/format'

export function timezoneLabel(tz: string): string {
  return tz === 'Asia/Dhaka' ? '(বাংলাদেশ সময়)' : tz.replace(/_/g, ' ')
}

/** "12:00 am Bangladesh time" — when today's count starts again. */
export function resetTimeText(usage: Usage): string {
  return `${formatTime(usage.resets_at, usage.timezone)} ${timezoneLabel(usage.timezone)}`
}

// Up to this many downloads per day are drawn as one segment each; larger
// limits get a plain bar.
const MAX_SEGMENTS = 10

export interface QuotaCardProps {
  usage: Usage
  /** Current time from useClock(); 0 until known. */
  now: number
  className?: string
}

export function QuotaCard({ usage, now, className = '' }: QuotaCardProps) {
  const unlimited = usage.limit === null
  const limit = usage.limit ?? 0
  const remaining = unlimited ? null : Math.max(0, usage.remaining ?? limit - usage.used)
  const resetsIn = now > 0 && now < Date.parse(usage.resets_at) ? formatTimeUntilBn(usage.resets_at, now) : null
  const resetText = resetTimeText(usage)

  const tone = unlimited
    ? { icon: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/25', fill: 'bg-indigo-400' }
    : remaining === 0
    ? { icon: 'bg-red-500/15 text-red-300 border-red-500/25', fill: 'bg-red-400' }
    : remaining === 1
    ? { icon: 'bg-amber-500/15 text-amber-300 border-amber-500/25', fill: 'bg-amber-400' }
    : { icon: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25', fill: 'bg-emerald-400' }

  let headline: ReactNode
  let detail: ReactNode
  if (unlimited) {
    headline = (
      <span className="inline-flex items-center gap-2">
        আনলিমিটেড ডাউনলোড
        <Badge tone="brand">আনলিমিটেড</Badge>
      </span>
    )
    detail = `আপনার অ্যাকাউন্টে প্রতিদিন আনলিমিটেড ডাউনলোড · আজ ${countBn(usage.used, 'ডাউনলোড')}।`
  } else if (limit === 0) {
    headline = 'ডাউনলোড বন্ধ আছে'
    detail = 'আপনার অ্যাকাউন্টে এখন ডাউনলোড বন্ধ রাখা হয়েছে। ভুল মনে হলে অ্যাডমিনের সাথে যোগাযোগ করুন।'
  } else if (remaining === 0) {
    headline = 'আজকের সীমা শেষ'
    detail = (
      <>
        আজকের {limit === 1 ? 'ডাউনলোডটি' : `${formatNumber(limit)}টি ডাউনলোডই`} ব্যবহার হয়ে গেছে। আবার চালু হবে{' '}
        {resetText}-এ{resetsIn ? ` (${resetsIn} পর)` : ''}।
      </>
    )
  } else {
    headline = (
      <>
        আজ <span className="tabular-nums">{formatNumber(limit)}</span>টির মধ্যে{' '}
        <span className="tabular-nums">{formatNumber(remaining ?? 0)}</span>টি ডাউনলোড বাকি
      </>
    )
    detail = (
      <>
        নতুন করে শুরু: {resetText}
        {resetsIn ? <span className="text-slate-500"> · {resetsIn} পর</span> : null}
      </>
    )
  }

  const segments = !unlimited && limit > 0 && limit <= MAX_SEGMENTS
  const percent = usagePercent(usage)

  return (
    <section
      aria-labelledby="quota-title"
      className={`surface-card px-4 py-3.5 sm:px-5 sm:py-4 ${className}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`w-10 h-10 flex-shrink-0 rounded-xl border flex items-center justify-center ${tone.icon}`}
          aria-hidden="true"
        >
          {unlimited ? <InfinityIcon className="w-5 h-5" /> : <Download className="w-[18px] h-[18px]" />}
        </span>
        <div className="flex-1 min-w-0">
          <h2 id="quota-title" className="text-[15px] font-semibold text-white leading-snug" style={{ letterSpacing: 0 }}>
            {headline}
          </h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-slate-400">{detail}</p>
        </div>
      </div>

      {!unlimited && limit > 0 && (
        <div className="mt-3 sm:pl-[52px]">
          {segments ? (
            <div
              className="flex gap-1.5"
              role="img"
              aria-label={`আজ ${formatNumber(limit)}টির মধ্যে ${formatNumber(usage.used)}টি ডাউনলোড ব্যবহার হয়েছে`}
            >
              {Array.from({ length: limit }, (_, i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${i < usage.used ? tone.fill : 'bg-white/[0.08]'}`}
                />
              ))}
            </div>
          ) : (
            <div
              className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden"
              role="progressbar"
              aria-label="আজ ব্যবহার করা ডাউনলোড"
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-valuenow={Math.min(usage.used, limit)}
            >
              <div className={`h-full rounded-full ${tone.fill}`} style={{ width: `${percent}%` }} />
            </div>
          )}
          <p className="mt-2 text-[11px] text-slate-500">শুধু সম্পূর্ণ ডাউনলোড গোনা হয়। লিংক দেখা ফ্রি।</p>
        </div>
      )}
    </section>
  )
}

export default QuotaCard
