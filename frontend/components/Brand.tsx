// components/Brand.tsx
//
// The UniStream Downloader logo. The mark is a white "U" with a mint arrow
// dropping into it, on a green tile: the same artwork as public/favicon.svg
// and the app icons in public/icons. The lockup adds the stacked wordmark
// used in the navbar and footer.

import { useId } from 'react'

export const BRAND_NAME = 'UniStream Downloader'

export function BrandMark({ className = 'w-8 h-8' }: { className?: string }) {
  // Gradient ids must be unique on the page (the navbar and footer both draw it).
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const tile = `${uid}-tile`
  const shine = `${uid}-shine`
  const arrow = `${uid}-arrow`
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={tile} x1="60" y1="30" x2="452" y2="482" gradientUnits="userSpaceOnUse">
          <stop stopColor="#17a370" />
          <stop offset=".55" stopColor="#0b6b4b" />
          <stop offset="1" stopColor="#053a29" />
        </linearGradient>
        <radialGradient
          id={shine}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(130 70) rotate(50) scale(420 320)"
        >
          <stop stopColor="#fff" stopOpacity=".26" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={arrow} x1="256" y1="110" x2="256" y2="300" gradientUnits="userSpaceOnUse">
          <stop stopColor="#d4ffe9" />
          <stop offset="1" stopColor="#6ff0b4" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill={`url(#${tile})`} />
      <rect width="512" height="512" rx="116" fill={`url(#${shine})`} />
      <path d="M156 146V278a100 100 0 0 0 200 0V146" fill="none" stroke="#fff" strokeWidth="56" strokeLinecap="round" />
      <path d="M256 124V250" fill="none" stroke={`url(#${arrow})`} strokeWidth="34" strokeLinecap="round" />
      <path d="M218 242h76l-38 50z" fill={`url(#${arrow})`} stroke={`url(#${arrow})`} strokeWidth="12" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Mark + "UniStream / DOWNLOADER" wordmark. `hideWordmarkBelow360` keeps the
 * smallest phones' navbar uncluttered (the link keeps its accessible name).
 */
export function BrandLockup({
  size = 'md',
  hideWordmarkBelow360 = false,
}: {
  size?: 'sm' | 'md'
  hideWordmarkBelow360?: boolean
}) {
  const small = size === 'sm'
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark className={`${small ? 'w-8 h-8' : 'w-9 h-9'} flex-shrink-0 drop-shadow-sm`} />
      <span
        className={`flex flex-col leading-none ${hideWordmarkBelow360 ? 'max-[359px]:sr-only' : ''}`}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        <span className={`${small ? 'text-[15px]' : 'text-[16px]'} font-bold text-white`} style={{ letterSpacing: '-0.01em' }}>
          UniStream
        </span>
        <span className="brand-tracking mt-[3px] text-[9.5px] font-semibold uppercase tracking-[0.26em] text-indigo-600">
          Downloader
        </span>
      </span>
    </span>
  )
}
