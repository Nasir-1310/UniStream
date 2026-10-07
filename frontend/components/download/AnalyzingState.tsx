// components/download/AnalyzingState.tsx
//
// Shown while /video-info runs. Analysis usually takes a few seconds, but the
// first request after the API has slept (Render free tier) can take up to a
// minute, so after a while the copy says so instead of looking stuck.

import { Film, X } from 'lucide-react'

export interface AnalyzingStateProps {
  /** True once the request has run long enough to explain the wait. */
  slow: boolean
  onCancel: () => void
}

const BARS = [40, 65, 50, 80, 55, 70, 45, 60, 75, 50]

export function AnalyzingState({ slow, onCancel }: AnalyzingStateProps) {
  return (
    <div className="surface-card flex flex-col items-center justify-center px-5 py-12 sm:py-16 text-center">
      <div className="relative w-20 h-20" aria-hidden="true">
        <svg className="absolute inset-0 w-20 h-20 animate-spin" style={{ animationDuration: '3s' }} viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" fill="none" strokeWidth="2" className="stroke-white/[0.06]" />
          <circle
            cx="40"
            cy="40"
            r="36"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="56 170"
            className="stroke-indigo-500/70"
          />
        </svg>
        <svg
          className="absolute inset-0 w-20 h-20 animate-spin"
          style={{ animationDuration: '1.8s', animationDirection: 'reverse' }}
          viewBox="0 0 80 80"
        >
          <circle cx="40" cy="40" r="26" fill="none" strokeWidth="2" className="stroke-white/[0.04]" />
          <circle
            cx="40"
            cy="40"
            r="26"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="30 133"
            className="stroke-sky-400/60"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
            <Film className="w-5 h-5 text-indigo-400" />
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-1.5 max-w-sm" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-white">Analyzing the link…</p>
        <p className="text-xs leading-relaxed text-slate-500">
          {slow
            ? 'Still working. The first request after a quiet spell can take up to a minute while the server wakes up.'
            : 'Finding the available qualities, sizes and details.'}
        </p>
      </div>

      <div className="mt-6 flex items-end gap-1 h-8" aria-hidden="true">
        {BARS.map((h, i) => (
          <div
            key={i}
            className="w-1.5 rounded-full bg-indigo-500/40"
            style={{ height: `${h}%`, animation: `dlbar 1.2s ease-in-out ${i * 0.1}s infinite alternate` }}
          />
        ))}
      </div>
      <style>{`
        @keyframes dlbar {
          from { opacity: 0.3; transform: scaleY(0.6); }
          to   { opacity: 1;   transform: scaleY(1);   }
        }
      `}</style>

      <button type="button" onClick={onCancel} className="btn-ghost mt-6">
        <X className="w-4 h-4" aria-hidden="true" />
        Cancel
      </button>
    </div>
  )
}

export default AnalyzingState
