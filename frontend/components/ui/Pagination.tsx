'use client'
// components/ui/Pagination.tsx

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatNumber } from '@/lib/format'

export interface PaginationProps {
  /** 1-based current page. */
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  /** Offer a "Rows per page" select when both are given. */
  pageSizeOptions?: number[]
  onPageSizeChange?: (size: number) => void
  /** Disable while a page is loading. */
  disabled?: boolean
  /** Noun for the summary, e.g. "users" → "Showing 1–25 of 312 users". */
  itemLabel?: string
  className?: string
}

/** Page numbers to show: always first/last, the current page ±1, gaps as null. */
function pageList(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const items: (number | null)[] = [1]
  const start = Math.max(2, page - 1)
  const end = Math.min(pages - 1, page + 1)
  if (start > 2) items.push(null)
  for (let p = start; p <= end; p++) items.push(p)
  if (end < pages - 1) items.push(null)
  items.push(pages)
  return items
}

const navButton =
  'inline-flex items-center justify-center min-w-10 h-10 px-2.5 rounded-lg border text-[13px] font-medium transition-colors ' +
  'border-white/10 text-slate-300 hover:bg-white/[0.06] hover:text-white disabled:opacity-40 disabled:pointer-events-none'

/**
 * "Showing 26–50 of 312" summary with previous/next and page buttons.
 * Phones get a compact "Page 2 of 13" between the arrows.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
  disabled = false,
  itemLabel = 'results',
  className = '',
}: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  const current = Math.min(Math.max(1, page), pages)
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1
  const to = Math.min(total, current * pageSize)
  const go = (target: number) => {
    if (!disabled && target >= 1 && target <= pages && target !== current) onPageChange(target)
  }

  return (
    <nav
      aria-label="Pagination"
      className={`flex flex-col-reverse sm:flex-row items-center justify-between gap-3 text-[13px] text-slate-400 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <p aria-live="polite">
          {total === 0 ? (
            `No ${itemLabel}`
          ) : (
            <>
              Showing <span className="text-slate-200 tabular-nums">{formatNumber(from)}–{formatNumber(to)}</span> of{' '}
              <span className="text-slate-200 tabular-nums">{formatNumber(total)}</span> {itemLabel}
            </>
          )}
        </p>
        {pageSizeOptions && onPageSizeChange && (
          <label className="flex items-center gap-2">
            <span>Rows</span>
            <select
              value={pageSize}
              disabled={disabled}
              onChange={e => onPageSizeChange(Number(e.target.value))}
              className="h-10 rounded-lg border border-white/10 bg-[#0d0f1a] px-2 text-slate-200 outline-none focus:border-indigo-500/70"
            >
              {pageSizeOptions.map(size => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={navButton}
            onClick={() => go(current - 1)}
            disabled={disabled || current <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>

          <span className="sm:hidden px-2 tabular-nums text-slate-300">
            Page {current} of {pages}
          </span>

          <div className="hidden sm:flex items-center gap-1.5">
            {pageList(current, pages).map((p, index) =>
              p === null ? (
                <span key={`gap-${index}`} className="px-1 text-slate-600" aria-hidden="true">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => go(p)}
                  disabled={disabled}
                  aria-label={`Page ${p}`}
                  aria-current={p === current ? 'page' : undefined}
                  className={`${navButton} tabular-nums ${
                    p === current ? 'bg-indigo-500/20 border-indigo-500/40 text-white' : ''
                  }`}
                >
                  {p}
                </button>
              ),
            )}
          </div>

          <button
            type="button"
            className={navButton}
            onClick={() => go(current + 1)}
            disabled={disabled || current >= pages}
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </nav>
  )
}

export default Pagination
