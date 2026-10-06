// components/ui/Spinner.tsx
import { Loader2 } from 'lucide-react'

const SIZES = {
  xs: 'w-3 h-3',
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-8 h-8',
} as const

export interface SpinnerProps {
  size?: keyof typeof SIZES
  /** Announced to screen readers; pass null when a visible label already says it. */
  label?: string | null
  className?: string
}

/** Inline loading indicator. Inside buttons pass `label={null}` and keep the button text. */
export function Spinner({ size = 'sm', label = 'Loading', className = '' }: SpinnerProps) {
  const icon = <Loader2 className={`${SIZES[size]} animate-spin flex-shrink-0 ${className}`} aria-hidden="true" />
  if (label === null) return icon
  return (
    <span role="status" className="inline-flex items-center">
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  )
}

export interface PageLoaderProps {
  /** Visible text under the spinner. */
  label?: string
  /** Fill the viewport (default) or just the available space. */
  fullScreen?: boolean
}

/** Centered spinner for whole pages or sections while data loads. */
export function PageLoader({ label = 'Loading…', fullScreen = true }: PageLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 text-slate-400 ${
        fullScreen ? 'min-h-[60svh]' : 'py-16'
      }`}
    >
      <Loader2 className="w-7 h-7 animate-spin text-indigo-400" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export default Spinner
