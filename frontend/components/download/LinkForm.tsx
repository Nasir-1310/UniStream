'use client'
// components/download/LinkForm.tsx
//
// The link box: paste or type a video URL, see straight away whether it is a
// supported platform (the matching chip lights up), then get the video's
// qualities. The same check runs again on submit, so unsupported sites never
// reach the API.

import { forwardRef, type FormEvent } from 'react'
import { Check, ClipboardPaste, Link2, Search, X } from 'lucide-react'
import { PlatformIcon, Spinner, platformStyle } from '@/components/ui'
import { PLATFORMS, PLATFORM_LABELS, UNSUPPORTED_URL_MESSAGE, validateVideoUrl } from '@/lib/validation'
import { translateServerText } from '@/lib/serverText'
import { extractLink } from './types'

export interface LinkFormProps {
  value: string
  onChange: (value: string) => void
  /** Look up the current value (the page validates it again). */
  onSubmit: () => void
  /** Read the clipboard into the box. */
  onPaste: () => void
  /** Clear the box (and any result). */
  onClear: () => void
  /** Validation or API error to show under the box. */
  error: string | null
  analyzing: boolean
  /** Why looking up a link is not possible right now (download running, offline); null when it is. */
  lockedReason: string | null
}

const INPUT_ID = 'video-url'

export const LinkForm = forwardRef<HTMLInputElement, LinkFormProps>(function LinkForm(
  { value, onChange, onSubmit, onPaste, onClear, error, analyzing, lockedReason },
  ref,
) {
  const trimmed = value.trim()
  const check = trimmed ? validateVideoUrl(extractLink(trimmed)) : null
  const detected = check?.ok ? check.platform ?? null : null
  // Only nag about unsupported sites once the text looks like a link.
  const looksLikeLink = /^\S+\.\S{2,}/.test(trimmed)
  const unsupported = !error && Boolean(check && !check.ok && looksLikeLink)
  const locked = Boolean(lockedReason)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!analyzing && !locked) onSubmit()
  }

  const describedBy = error ? `${INPUT_ID}-error` : `${INPUT_ID}-hint`

  return (
    <form onSubmit={submit} noValidate className="surface-card p-3.5 sm:p-5" aria-label="লিংক থেকে ভিডিও আনুন">
      <label htmlFor={INPUT_ID} className="block text-[13px] font-medium text-slate-300 mb-2">
        ভিডিওর লিংক
      </label>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1 min-w-0">
          <Link2
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none"
            aria-hidden="true"
          />
          <input
            ref={ref}
            id={INPUT_ID}
            type="url"
            inputMode="url"
            enterKeyHint="go"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={analyzing}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="input-field h-12 pl-10 pr-11"
          />
          {value && !analyzing && (
            <button
              type="button"
              onClick={onClear}
              className="btn-icon absolute right-1 top-1/2 -translate-y-1/2"
              aria-label="লিংক মুছুন"
              title="মুছুন"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onPaste}
            disabled={analyzing || locked}
            className="btn-secondary h-12 px-4 flex-shrink-0"
          >
            <ClipboardPaste className="w-4 h-4" aria-hidden="true" />
            পেস্ট
          </button>
          <button
            type="submit"
            disabled={analyzing || locked || !trimmed}
            aria-describedby={lockedReason ? `${INPUT_ID}-locked` : undefined}
            className="btn-primary h-12 px-5 flex-1 sm:flex-none sm:min-w-[132px]"
          >
            {analyzing ? <Spinner size="sm" label={null} /> : <Search className="w-4 h-4" aria-hidden="true" />}
            {analyzing ? 'ভিডিও আনা হচ্ছে…' : 'ভিডিও আনুন'}
          </button>
        </div>
      </div>

      {/* Errors are announced; hints are not. */}
      <div id={`${INPUT_ID}-error`} aria-live="polite" className="empty:hidden">
        {error && <p className="mt-2.5 text-[13px] leading-relaxed text-red-300">{error}</p>}
      </div>
      {!error && (
        <p
          id={`${INPUT_ID}-hint`}
          className={`mt-2.5 text-xs leading-relaxed ${unsupported ? 'text-amber-300' : 'text-slate-500'}`}
        >
          {unsupported
            ? `${translateServerText(UNSUPPORTED_URL_MESSAGE)} অন্য সাইট এখনো চালু হয়নি।`
            : 'YouTube, Facebook বা Instagram অ্যাপে Share → Copy link চাপুন, তারপর এখানে পেস্ট করুন।'}
        </p>
      )}
      {lockedReason && (
        <p id={`${INPUT_ID}-locked`} className="mt-1.5 text-xs text-slate-400">
          {lockedReason}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="যেসব প্ল্যাটফর্ম চলে" role="group">
        <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-500 mr-1">চলে</span>
        {PLATFORMS.map(platform => {
          const active = detected === platform
          const style = platformStyle(platform)
          return (
            <span
              key={platform}
              className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border text-xs font-medium transition-colors ${
                active && style ? style.badge : 'border-white/[0.08] bg-white/[0.03] text-slate-400'
              }`}
            >
              <PlatformIcon platform={platform} className="w-3.5 h-3.5" />
              {PLATFORM_LABELS[platform]}
              {active && (
                <>
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="sr-only">(শনাক্ত হয়েছে)</span>
                </>
              )}
            </span>
          )
        })}
      </div>
    </form>
  )
})

export default LinkForm
