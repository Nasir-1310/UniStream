'use client'
// components/download/VideoSummary.tsx
//
// The video behind the link: thumbnail, title, channel and its details.
// A compact side-by-side card on phones (so the formats stay near the top),
// a full sidebar from the `lg` breakpoint.

import { useState, type ReactNode } from 'react'
import { Calendar, Clock, ExternalLink, Eye, Film, Layers, RefreshCw, ThumbsUp, UserRound } from 'lucide-react'
import { PlatformBadge } from '@/components/ui'
import type { VideoInfo } from '@/lib/api'
import { formatCompact, formatDuration, formatNumber } from '@/lib/format'
import { PLATFORM_LABELS, type Platform } from '@/lib/validation'

export interface VideoSummaryProps {
  info: VideoInfo
  /** Platform detected from the link. */
  platform: Platform | null
  /** The video's link (opened by "View original"). */
  url: string
  onReset: () => void
  /** True while a download runs (starting over would cancel it). */
  resetDisabled: boolean
}

/** yt-dlp's upload_date is "YYYYMMDD". */
function uploadDate(value: string | undefined): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value ?? '')
  if (!match) return value || null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

function Thumbnail({ src, title, duration }: { src: string; title: string; duration: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="relative w-full aspect-video rounded-lg lg:rounded-xl overflow-hidden bg-white/[0.04] border border-white/[0.06]">
      {src && !failed ? (
        // Thumbnails come from many platform CDNs, so next/image's allow-list doesn't fit.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={title ? `Thumbnail: ${title}` : 'Video thumbnail'}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          loading="eager"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center" aria-hidden="true">
          <Film className="w-8 h-8 text-white/20" />
        </div>
      )}
      {duration && (
        <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold font-mono text-white">
          <span className="sr-only">Duration </span>
          {duration}
        </span>
      )}
    </div>
  )
}

function MetaRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="flex items-center gap-2 text-xs text-slate-500">
        <span className="text-slate-600" aria-hidden="true">
          {icon}
        </span>
        {label}
      </dt>
      <dd className="min-w-0 truncate text-right text-xs font-semibold text-slate-200">{children}</dd>
    </div>
  )
}

export function VideoSummary({ info, platform, url, onReset, resetDisabled }: VideoSummaryProps) {
  const duration = formatDuration(info.duration)
  const uploaded = uploadDate(info.upload_date)
  const platformName = platform ? PLATFORM_LABELS[platform] : info.platform || 'the original site'
  const title = info.title?.trim() || 'Untitled video'

  return (
    <aside aria-label="Video details" className="space-y-3 lg:space-y-4">
      <div className="surface-card p-3 sm:p-4 lg:p-0 lg:bg-transparent lg:border-0">
        <div className="flex gap-3 sm:gap-4 lg:flex-col">
          <div className="w-32 sm:w-48 lg:w-full flex-shrink-0">
            <Thumbnail key={info.thumbnail} src={info.thumbnail} title={title} duration={duration} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm sm:text-[15px] font-semibold text-white leading-snug line-clamp-3 break-words" style={{ letterSpacing: 0 }}>
              {title}
            </h2>
            {info.uploader && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-sky-300/90 min-w-0">
                <UserRound className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                <span className="truncate">{info.uploader}</span>
              </p>
            )}
            {platform && (
              <div className="mt-2">
                <PlatformBadge platform={platform} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Full details only where there is room for them. */}
      <div className="hidden lg:block surface-card overflow-hidden">
        <p className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 border-b border-white/[0.05]">
          Video details
        </p>
        <dl className="divide-y divide-white/[0.05]">
          {duration && (
            <MetaRow icon={<Clock className="w-3.5 h-3.5" />} label="Duration">
              {duration}
            </MetaRow>
          )}
          {Boolean(info.view_count) && (
            <MetaRow icon={<Eye className="w-3.5 h-3.5" />} label="Views">
              {formatCompact(info.view_count)}
            </MetaRow>
          )}
          {Boolean(info.like_count) && (
            <MetaRow icon={<ThumbsUp className="w-3.5 h-3.5" />} label="Likes">
              {formatCompact(info.like_count)}
            </MetaRow>
          )}
          {uploaded && (
            <MetaRow icon={<Calendar className="w-3.5 h-3.5" />} label="Uploaded">
              {uploaded}
            </MetaRow>
          )}
          <MetaRow icon={<Layers className="w-3.5 h-3.5" />} label="Download options">
            {formatNumber(info.formats.length)}
          </MetaRow>
        </dl>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onReset}
          disabled={resetDisabled}
          title={resetDisabled ? 'Wait for the download to finish' : undefined}
          className="btn-secondary btn-sm flex-1"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Try another link
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost border-white/[0.08] flex-shrink-0"
          aria-label={`View original on ${platformName} (opens in a new tab)`}
          title={`View on ${platformName}`}
        >
          <ExternalLink className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline lg:hidden xl:inline">Original</span>
        </a>
      </div>
    </aside>
  )
}

export default VideoSummary
