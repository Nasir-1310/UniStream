// components/download/GettingStarted.tsx
//
// What the page shows before the first link: three steps and what each
// platform supports, so nobody has to guess why a private post fails.

import { ClipboardPaste, Download, Search } from 'lucide-react'
import { PlatformIcon } from '@/components/ui'
import { PLATFORMS, PLATFORM_LABELS, type Platform } from '@/lib/validation'

const STEPS = [
  { Icon: ClipboardPaste, title: 'Copy the link', text: 'In the app, tap Share → Copy link.' },
  { Icon: Search, title: 'Paste it here', text: 'Tap Get video to see every quality and its file size.' },
  { Icon: Download, title: 'Download', text: 'Choose a quality and it saves to your device.' },
]

const PLATFORM_NOTES: Record<Platform, string> = {
  youtube: 'Videos and Shorts up to 4K, or audio only (MP3).',
  facebook: 'Public videos and reels.',
  instagram: 'Public reels and video posts.',
}

export function GettingStarted() {
  return (
    <section aria-labelledby="start-title" className="surface-card p-5 sm:p-7">
      <h2 id="start-title" className="text-base sm:text-lg font-semibold text-white" style={{ letterSpacing: 0 }}>
        Ready when you are
      </h2>
      <p className="mt-1 text-[13px] text-slate-400">Paste a link above to see the available qualities.</p>

      <ol className="mt-5 grid gap-3 sm:grid-cols-3">
        {STEPS.map(({ Icon, title, text }, i) => (
          <li key={title} className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            <span className="relative w-9 h-9 flex-shrink-0 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-300">
              <Icon className="w-4 h-4" aria-hidden="true" />
              <span className="absolute -top-1.5 -left-1.5 w-[18px] h-[18px] rounded-full bg-indigo-600 text-[10px] font-bold text-white flex items-center justify-center">
                {i + 1}
              </span>
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-slate-100">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 border-t border-white/[0.06] pt-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">What you can download</h3>
        <ul className="mt-3 grid gap-2.5 sm:grid-cols-3">
          {PLATFORMS.map(platform => (
            <li key={platform} className="flex items-start gap-2.5 text-[13px]">
              <PlatformIcon platform={platform} className="w-4 h-4 mt-0.5" />
              <span className="min-w-0">
                <span className="font-medium text-slate-200">{PLATFORM_LABELS[platform]}</span>
                <span className="block text-xs leading-relaxed text-slate-500">{PLATFORM_NOTES[platform]}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Private, friends-only and age-restricted videos may not work. Other sites aren&apos;t supported
          yet.
        </p>
      </div>
    </section>
  )
}

export default GettingStarted
