'use client'
// components/admin/DownloadsChart.tsx
//
// 14-day downloads column chart and the 30-day platform split, in plain
// HTML/CSS (no chart library). One series, so no legend: the card title names
// it. Every column is focusable and shows its value on hover/focus; today and
// the busiest day carry direct labels; a visually hidden table gives screen
// readers the full data.

import { useState } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { PlatformIcon, platformStyle } from '@/components/ui'
import type { DailyCount } from '@/lib/api'
import { formatNumber, pluralize } from '@/lib/format'

// Dates arrive as local calendar days ("2026-10-06"); format them as UTC so
// the browser's own timezone can't shift them by a day.
const dayLong = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const dayShort = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' })
const monthShort = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' })

function asDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

// Newer ICU data abbreviates September as "Sept"; keep three letters like lib/format.
const longDay = (date: Date) => dayLong.format(date).replace('Sept', 'Sep')
const shortMonth = (date: Date) => monthShort.format(date).replace('Sept', 'Sep')

/** Round the axis maximum up to a clean, even number (so the midline is a whole number). */
export function niceMax(max: number): number {
  if (max <= 4) return 4
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)))
  for (const step of [1, 2, 4, 6, 8, 10]) {
    const candidate = step * magnitude
    if (candidate >= max && candidate % 2 === 0) return candidate
  }
  return 10 * magnitude
}

export function DownloadsChart({ daily }: { daily: DailyCount[] }) {
  const [active, setActive] = useState<number | null>(null)
  const counts = daily.map(day => day.count)
  const max = Math.max(0, ...counts)
  const top = niceMax(max)
  const total = counts.reduce((sum, n) => sum + n, 0)
  const todayIndex = daily.length - 1
  const peakIndex = max > 0 ? counts.lastIndexOf(max) : -1

  // Last 7 days against the 7 before them.
  const recent = counts.slice(-7).reduce((a, b) => a + b, 0)
  const previous = counts.slice(-14, -7).reduce((a, b) => a + b, 0)
  const change = previous > 0 ? Math.round(((recent - previous) / previous) * 100) : null

  if (!daily.length) return null

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 mb-4">
        <p className="text-2xl font-semibold text-white leading-none">
          {formatNumber(total)}
          <span className="ml-2 text-[13px] font-normal text-slate-400">in 14 days</span>
        </p>
        {change !== null && (
          <p className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            {change >= 0 ? (
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
            )}
            <span className="font-semibold text-slate-200">
              {change >= 0 ? '+' : '−'}
              {Math.abs(change)}%
            </span>
            vs the previous 7 days
          </p>
        )}
      </div>

      <div className="relative h-44 sm:h-52 pl-8" aria-hidden="true">
        {/* Gridlines + y-axis ticks (top, middle, baseline). */}
        {[top, top / 2, 0].map(tick => (
          <div
            key={tick}
            className="absolute left-8 right-0 border-t border-white/[0.06]"
            style={{ bottom: `${(tick / top) * 100}%` }}
          >
            <span className="absolute -left-8 -translate-y-1/2 w-6 text-right text-[10px] tabular-nums text-slate-500">
              {formatNumber(tick)}
            </span>
          </div>
        ))}

        <div className="absolute inset-y-0 left-8 right-0 flex items-stretch">
          {daily.map((day, index) => {
            const height = (day.count / top) * 100
            const isToday = index === todayIndex
            const labelled = (index === todayIndex || index === peakIndex) && day.count > 0 && active !== index
            return (
              <div key={day.date} className="relative flex-1 flex items-end justify-center">
                {labelled && (
                  <span
                    className="absolute left-1/2 -translate-x-1/2 mb-1 text-[11px] font-semibold tabular-nums text-slate-200"
                    style={{ bottom: `${height}%` }}
                  >
                    {formatNumber(day.count)}
                  </span>
                )}
                <span
                  className={`w-[62%] max-w-[24px] rounded-t-[4px] transition-colors ${
                    isToday ? 'bg-sky-400' : active === index ? 'bg-indigo-300' : 'bg-indigo-400/75'
                  }`}
                  style={{ height: `${height}%`, minHeight: day.count > 0 ? 2 : 0 }}
                />
              </div>
            )
          })}
        </div>

        {active !== null && daily[active] && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-white/10 bg-[#151829] px-2.5 py-1.5 shadow-xl shadow-black/50 whitespace-nowrap"
            style={{
              left: `calc(2rem + (100% - 2rem) * ${(active + 0.5) / daily.length})`,
              bottom: `calc(${(daily[active].count / top) * 100}% + 10px)`,
              transform: `translateX(${active < 2 ? '-20%' : active > daily.length - 3 ? '-80%' : '-50%'})`,
            }}
          >
            <p className="text-sm font-semibold text-white tabular-nums">{pluralize(daily[active].count, 'download')}</p>
            <p className="text-[11px] text-slate-400">
              {longDay(asDate(daily[active].date))}
              {active === todayIndex ? ' · today' : ''}
            </p>
          </div>
        )}
      </div>

      {/* Hit targets: full-height columns, larger than the bars themselves. */}
      <div className="relative -mt-44 sm:-mt-52 h-44 sm:h-52 ml-8 flex">
        {daily.map((day, index) => (
          <button
            key={day.date}
            type="button"
            className="flex-1 h-full rounded-md outline-none focus-visible:bg-white/[0.04] focus-visible:ring-1 focus-visible:ring-indigo-400/60"
            aria-label={`${longDay(asDate(day.date))}${index === todayIndex ? ' (today)' : ''}: ${pluralize(day.count, 'download')}`}
            onPointerEnter={() => setActive(index)}
            onPointerLeave={() => setActive(current => (current === index ? null : current))}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(current => (current === index ? null : current))}
            onClick={() => setActive(index)}
          />
        ))}
      </div>

      {/* X axis: day of month; month name at the first day and where the month changes. */}
      <div className="ml-8 mt-1.5 flex text-[10px] text-slate-500 tabular-nums" aria-hidden="true">
        {daily.map((day, index) => {
          const date = asDate(day.date)
          const newMonth = index === 0 || date.getUTCDate() === 1
          const isToday = index === todayIndex
          // On narrow screens label every other day (counting back from today).
          const sparse = (todayIndex - index) % 2 === 1
          return (
            <span key={day.date} className={`flex-1 text-center whitespace-nowrap ${sparse ? 'max-sm:invisible' : ''} ${isToday ? 'text-sky-300 font-semibold' : ''}`}>
              {isToday ? 'Today' : newMonth ? `${dayShort.format(date)} ${shortMonth(date)}` : dayShort.format(date)}
            </span>
          )
        })}
      </div>

      <table className="sr-only">
        <caption>Downloads per day, last 14 days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Downloads</th>
          </tr>
        </thead>
        <tbody>
          {daily.map(day => (
            <tr key={day.date}>
              <th scope="row">{longDay(asDate(day.date))}</th>
              <td>{day.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const PLATFORM_ORDER = ['YouTube', 'Facebook', 'Instagram']
const BAR_COLORS: Record<string, string> = {
  youtube: 'bg-red-400/85',
  facebook: 'bg-blue-400/85',
  instagram: 'bg-pink-400/85',
}

/** Horizontal bars: downloads per platform over the last 30 days. */
export function PlatformSplit({ platforms }: { platforms: Record<string, number> }) {
  const entries = Object.entries(platforms).sort(([a, x], [b, y]) => {
    const ia = PLATFORM_ORDER.indexOf(a)
    const ib = PLATFORM_ORDER.indexOf(b)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    return y - x
  })
  const total = entries.reduce((sum, [, n]) => sum + n, 0)

  return (
    <ul className="space-y-4">
      {entries.map(([name, count]) => {
        const share = total > 0 ? Math.round((count / total) * 100) : 0
        const key = platformStyle(name) ? name.toLowerCase() : ''
        return (
          <li key={name}>
            <div className="flex items-center gap-2 text-[13px]">
              <PlatformIcon platform={name} className="w-4 h-4" />
              <span className="text-slate-200">{name}</span>
              <span className="ml-auto tabular-nums text-slate-200 font-semibold">{formatNumber(count)}</span>
              <span className="w-10 text-right tabular-nums text-slate-500">{share}%</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-white/[0.05] overflow-hidden" aria-hidden="true">
              <div
                className={`h-full rounded-full ${BAR_COLORS[key] ?? 'bg-slate-400/70'}`}
                style={{ width: `${total > 0 ? Math.max(count > 0 ? 2 : 0, (count / total) * 100) : 0}%` }}
              />
            </div>
          </li>
        )
      })}
      {total === 0 && <li className="text-xs text-slate-500">No downloads in the last 30 days yet.</li>}
    </ul>
  )
}
