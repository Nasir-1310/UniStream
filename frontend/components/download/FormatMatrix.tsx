'use client'
// components/download/FormatMatrix.tsx
//
// Every quality the server found, grouped into video and audio with a
// filter. Each row downloads its quality and shows live progress inline.
// Phones get one card per format with a full-size button; from `sm` up the
// rows line up as a table.

import { useState, type Ref } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  CircleCheck,
  Download,
  Flag,
  Layers,
  Lock,
  Music,
  RefreshCw,
  Video,
  X,
} from 'lucide-react'
import { Badge, EmptyState, Spinner, type BadgeTone } from '@/components/ui'
import type { DownloadProgressEvent, VideoFormat } from '@/lib/api'
import { countBn } from '@/lib/format'
import { IDLE, formatName, heightOf, isVideoExt, type RowState } from './types'

type Filter = 'all' | 'audio' | string

export interface FormatMatrixProps {
  formats: VideoFormat[]
  rows: Record<string, RowState>
  /** format_id of the running download, if any. */
  activeId: string | null
  onDownload: (format: VideoFormat) => void
  onCancel: () => void
  /** Open the problem report for a failed download (its message is passed along). */
  onReport?: (format: VideoFormat, message: string) => void
  /** Why no download can start right now (limit reached, offline); null when they can. */
  blockedReason: string | null
  /** Receives focus after an analysis so screen readers land on the results. */
  headingRef?: Ref<HTMLHeadingElement>
}

const BLOCKED_ID = 'downloads-blocked-reason'

const EXT_STYLES: Record<string, string> = {
  mp4: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  webm: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  mkv: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  m4a: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  mp3: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  opus: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
}

function extStyle(ext: string): string {
  return EXT_STYLES[ext.toLowerCase()] ?? 'bg-white/[0.06] text-slate-300 border-white/15'
}

function ExtTag({ ext, className = '' }: { ext: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded border px-1.5 py-px text-[10px] font-bold uppercase tracking-wider ${extStyle(ext)} ${className}`}
    >
      {ext}
    </span>
  )
}

function sectionTitle(ext: string): string {
  return isVideoExt(ext) ? `ভিডিও (${ext.toUpperCase()})` : `শুধু অডিও (${ext.toUpperCase()})`
}

/** "12.4 MB", or null when the API couldn't tell. */
function sizeOf(format: VideoFormat): string | null {
  const size = format.filesize_human?.trim()
  return size && size.toLowerCase() !== 'unknown' ? size : null
}

/** Group by container: video containers first (MP4 before WebM…), then audio. */
function groupFormats(formats: VideoFormat[]) {
  const groups: Record<string, VideoFormat[]> = {}
  for (const format of formats) {
    const key = format.ext.toLowerCase()
    if (!groups[key]) groups[key] = []
    groups[key].push(format)
  }
  const order = ['mp4', 'webm', 'mkv', 'mov', 'avi']
  const exts = Object.keys(groups).sort((a, b) => {
    const ai = order.indexOf(a)
    const bi = order.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
  })
  return { groups, exts }
}

interface QualityBadge {
  label: string
  tone: BadgeTone
  hint: string
}

/**
 * Guidance for people choosing on a phone data plan: the sharpest stream,
 * 720p as the balanced pick, and the smallest when there's a real choice.
 */
function qualityBadges(formats: VideoFormat[]): Record<string, QualityBadge> {
  const videos = formats
    .filter(f => f.type === 'video' && heightOf(f.resolution))
    .sort((a, b) => (heightOf(b.resolution) ?? 0) - (heightOf(a.resolution) ?? 0))
  const badges: Record<string, QualityBadge> = {}
  if (!videos.length) return badges
  const top = videos[0]
  badges[top.format_id] = { label: 'সেরা কোয়ালিটি', tone: 'brand', hint: 'সবচেয়ে ঝকঝকে সংস্করণ' }
  const hd = videos.find(f => heightOf(f.resolution) === 720)
  if (hd && hd !== top) {
    badges[hd.format_id] = { label: 'প্রস্তাবিত', tone: 'success', hint: 'মাঝারি সাইজে ফোন আর ল্যাপটপে পরিষ্কার' }
  }
  const lowest = videos[videos.length - 1]
  if (videos.length >= 3 && (heightOf(lowest.resolution) ?? 0) <= 360 && !badges[lowest.format_id]) {
    badges[lowest.format_id] = { label: 'ডেটা সেভার', tone: 'info', hint: 'সবচেয়ে ছোট ফাইল, সবচেয়ে কম মোবাইল ডেটা' }
  }
  return badges
}

// ── Progress ──────────────────────────────────────────────────────────────────

function ProgressDetails({
  progress,
  audio,
  onCancel,
}: {
  progress: DownloadProgressEvent
  audio: boolean
  onCancel: () => void
}) {
  const { status } = progress
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent || 0)))
  const phase =
    status === 'queued'
      ? progress.position && progress.position > 1
        ? `লাইনে অপেক্ষা: আপনি ${progress.position} নম্বরে। নিজে থেকেই শুরু হবে।`
        : 'লাইনে অপেক্ষা: এরপরই আপনার পালা। নিজে থেকেই শুরু হবে।'
      : status === 'starting'
      ? 'ডাউনলোড প্রস্তুত হচ্ছে…'
      : status === 'merging'
      ? audio
        ? 'MP3-তে রূপান্তর হচ্ছে…'
        : 'ভিডিও আর অডিও জোড়া লাগানো হচ্ছে…'
      : null
  const showEta = progress.eta && progress.eta !== '--:--'
  const showTotal = progress.total_fmt && progress.total_fmt !== '?'

  return (
    <div className="mt-3">
      <div
        className="relative h-1.5 rounded-full bg-white/[0.06] overflow-hidden"
        role="progressbar"
        aria-label="ডাউনলোডের অগ্রগতি"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={phase ? undefined : percent}
        aria-valuetext={phase ?? `${percent}%`}
      >
        {phase ? (
          <div
            className={`absolute inset-y-0 w-1/2 rounded-full bg-gradient-to-r animate-[slide_1.5s_ease-in-out_infinite] ${
              status === 'merging'
                ? 'from-purple-500/0 via-purple-400 to-purple-500/0'
                : 'from-indigo-500/0 via-indigo-400 to-indigo-500/0'
            }`}
          />
        ) : (
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-400 transition-[width] duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <p className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400 tabular-nums">
          {phase ? (
            <span className={status === 'merging' ? 'text-purple-300' : 'text-indigo-300'}>{phase}</span>
          ) : (
            <>
              <span className="font-semibold text-slate-200">{percent}%</span>
              {progress.speed && <span>{progress.speed}</span>}
              {showEta && <span>{progress.eta} বাকি</span>}
              {showTotal && (
                <span className="text-slate-500">
                  {progress.total_fmt}-এর মধ্যে {progress.downloaded_fmt}
                </span>
              )}
            </>
          )}
        </p>
        <button type="button" onClick={onCancel} className="btn-ghost -mr-2 flex-shrink-0 text-xs">
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          বাতিল
        </button>
      </div>
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

interface FormatRowProps {
  format: VideoFormat
  state: RowState
  badge?: QualityBadge
  /** Another format is downloading. */
  locked: boolean
  blockedReason: string | null
  onDownload: (format: VideoFormat) => void
  onCancel: () => void
  onReport?: (format: VideoFormat, message: string) => void
}

function FormatRow({ format, state, badge, locked, blockedReason, onDownload, onCancel, onReport }: FormatRowProps) {
  const audio = format.type === 'audio' || !isVideoExt(format.ext)
  const size = sizeOf(format)
  const resolution = audio ? null : format.resolution
  const Icon = audio ? Music : Video
  const disabled = locked || Boolean(blockedReason)
  const label = formatName(format)
  const name = `${label}${size ? `, ${size}` : ''}`

  let action
  if (state.status === 'active') {
    const percent = Math.round(state.progress.percent || 0)
    action = (
      <span className="inline-flex items-center gap-1.5 h-10 px-1 text-xs font-semibold text-indigo-300 tabular-nums whitespace-nowrap">
        <Spinner size="xs" label={null} />
        {state.progress.status === 'downloading'
          ? `${percent}%`
          : state.progress.status === 'queued'
          ? `লাইনে #${state.progress.position ?? 1}`
          : 'কাজ চলছে…'}
      </span>
    )
  } else if (state.status === 'complete') {
    action = (
      <span className="inline-flex items-center gap-1.5 h-10 px-1 text-xs font-semibold text-emerald-300 whitespace-nowrap">
        <CircleCheck className="w-4 h-4" aria-hidden="true" />
        সেভ হয়েছে
      </span>
    )
  } else if (state.status === 'error' && state.retryable) {
    action = (
      <button
        type="button"
        onClick={() => onDownload(format)}
        disabled={disabled}
        aria-label={`আবার চেষ্টা: ${name} ডাউনলোড`}
        aria-describedby={blockedReason ? BLOCKED_ID : undefined}
        className="btn-outline btn-sm whitespace-nowrap text-red-200 border-red-500/30"
      >
        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
        আবার চেষ্টা
      </button>
    )
  } else {
    action = (
      <button
        type="button"
        onClick={() => onDownload(format)}
        disabled={disabled}
        aria-label={`${name} ডাউনলোড করুন`}
        aria-describedby={blockedReason ? BLOCKED_ID : undefined}
        title={locked ? 'চলমান ডাউনলোড শেষ হওয়া পর্যন্ত অপেক্ষা করুন' : blockedReason ?? undefined}
        className="btn-primary btn-sm whitespace-nowrap"
      >
        {blockedReason ? (
          <Lock className="w-3.5 h-3.5" aria-hidden="true" />
        ) : (
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
        )}
        <span className="max-[359px]:sr-only">ডাউনলোড</span>
      </button>
    )
  }

  const highlight =
    state.status === 'active'
      ? 'border-indigo-500/30 bg-indigo-500/[0.05]'
      : state.status === 'complete'
      ? 'border-emerald-500/25 bg-emerald-500/[0.04]'
      : state.status === 'error'
      ? 'border-red-500/25 bg-red-500/[0.04]'
      : 'border-white/[0.07] bg-white/[0.02] sm:hover:bg-white/[0.025]'

  return (
    <li
      className={`rounded-xl border p-3 sm:rounded-none sm:border-0 sm:border-t sm:first:border-t-0 sm:border-white/[0.05] sm:px-4 sm:py-3 transition-colors ${highlight}`}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_88px_88px_128px] items-center gap-3 sm:gap-4">
        <span
          className={`w-10 h-10 rounded-lg border flex items-center justify-center ${
            audio ? 'bg-pink-500/10 border-pink-500/20 text-pink-300' : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-300'
          }`}
          aria-hidden="true"
        >
          <Icon className="w-[18px] h-[18px]" />
        </span>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`text-sm font-semibold leading-snug break-words ${
                state.status === 'complete' ? 'text-emerald-200' : state.status === 'error' ? 'text-red-200' : 'text-white'
              }`}
            >
              {label}
            </span>
            {badge && (
              <Badge tone={badge.tone} title={badge.hint}>
                {badge.label}
              </Badge>
            )}
          </div>
          {/* Phones: details under the name (the table columns are hidden). */}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500 sm:hidden">
            <ExtTag ext={format.ext} />
            {resolution && <span>{resolution}</span>}
            {resolution && <span aria-hidden="true">·</span>}
            <span className={size ? 'text-slate-300' : ''}>{size ?? 'সাইজ অজানা'}</span>
          </p>
        </div>

        <span className="hidden sm:block text-xs font-mono text-slate-400">{format.resolution || '—'}</span>
        <span className="hidden sm:block text-xs text-slate-300 tabular-nums">{size ?? <span className="text-slate-500">অজানা</span>}</span>
        <div className="flex justify-end">{action}</div>
      </div>

      {state.status === 'active' && <ProgressDetails progress={state.progress} audio={audio} onCancel={onCancel} />}
      {state.status === 'complete' && (
        <p className="mt-2.5 flex items-start gap-1.5 text-xs text-emerald-300">
          <CheckCircle2 className="w-3.5 h-3.5 mt-px flex-shrink-0" aria-hidden="true" />
          ডিভাইসে সেভ হয়েছে। Downloads ফোল্ডার বা ব্রাউজারের ডাউনলোড তালিকায় দেখুন।
        </p>
      )}
      {state.status === 'error' && (
        <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-relaxed text-red-300">
          <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" aria-hidden="true" />
          <span>
            {state.message}
            {onReport && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => onReport(format, state.message)}
                  className="inline-flex items-center gap-1 font-semibold text-red-200 underline underline-offset-2 hover:text-white"
                >
                  <Flag className="w-3 h-3" aria-hidden="true" />
                  সমস্যাটি জানান
                </button>
              </>
            )}
          </span>
        </p>
      )}
    </li>
  )
}

// ── Matrix ────────────────────────────────────────────────────────────────────

export function FormatMatrix({
  formats,
  rows,
  activeId,
  onDownload,
  onCancel,
  onReport,
  blockedReason,
  headingRef,
}: FormatMatrixProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const { groups, exts } = groupFormats(formats)
  const badges = qualityBadges(formats)
  const videoExts = exts.filter(isVideoExt)
  const hasAudio = exts.some(ext => !isVideoExt(ext))

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: formats.length },
    // "Video" while there's one video type (always MP4 today); type names only when they differ.
    ...videoExts.map(ext => ({
      key: ext,
      label: videoExts.length === 1 ? 'Video' : ext.toUpperCase(),
      count: groups[ext].length,
    })),
    ...(hasAudio
      ? [{ key: 'audio', label: 'Audio', count: exts.filter(e => !isVideoExt(e)).reduce((n, e) => n + groups[e].length, 0) }]
      : []),
  ]
  // A filter from an earlier video may not exist for this one.
  const current = tabs.some(tab => tab.key === filter) ? filter : 'all'
  const visible =
    current === 'all' ? exts : current === 'audio' ? exts.filter(ext => !isVideoExt(ext)) : exts.filter(ext => ext === current)

  return (
    <section aria-labelledby="formats-title" className="min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3 sm:mb-4">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-400" aria-hidden="true" />
          <h2
            id="formats-title"
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold text-white outline-none"
            style={{ letterSpacing: 0 }}
          >
            কোয়ালিটি বেছে নিন
          </h2>
          <span className="text-xs text-slate-500">· {countBn(formats.length, 'অপশন')}</span>
        </div>

        {tabs.length > 2 && (
          <div
            role="group"
            aria-label="দেখান"
            className="no-scrollbar -mx-1 px-1 flex gap-1.5 overflow-x-auto"
          >
            {tabs.map(tab => {
              const selected = current === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilter(tab.key)}
                  aria-pressed={selected}
                  className={`h-10 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex-shrink-0 ${
                    selected
                      ? 'bg-indigo-600 text-[#fff] shadow-sm shadow-indigo-900/40'
                      : 'border border-white/[0.08] bg-white/[0.03] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'
                  }`}
                >
                  {tab.label}
                  <span className={`ml-1.5 tabular-nums ${selected ? 'text-[#fff]/75' : 'text-slate-600'}`}>{tab.count}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {blockedReason && (
        <p
          id={BLOCKED_ID}
          className="mb-3 flex items-start gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-300"
        >
          <Lock className="w-4 h-4 mt-0.5 flex-shrink-0 text-slate-500" aria-hidden="true" />
          <span>{blockedReason}</span>
        </p>
      )}

      {activeId && (
        <p className="mb-3 flex items-start gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.06] px-3.5 py-2.5 text-[13px] leading-relaxed text-indigo-200">
          <Spinner size="sm" label={null} className="mt-0.5 text-indigo-300" />
          <span>ডাউনলোড চলছে। শেষ না হওয়া পর্যন্ত এই পেজ খোলা রাখুন; শেষ হলে অন্য কোয়ালিটিগুলোও আবার চালু হবে।</span>
        </p>
      )}

      {formats.length === 0 ? (
        <div className="surface-card">
          <EmptyState
            icon={Video}
            title="এখানে ডাউনলোড করার মতো কিছু নেই"
            description="এই পোস্টে ডাউনলোডযোগ্য ভিডিও বা অডিও নেই। ছবির পোস্ট, লাইভ স্ট্রিম আর প্রাইভেট ভিডিও সাপোর্ট করে না।"
          />
        </div>
      ) : (
        <div className="space-y-5 sm:space-y-4">
          {visible.map(ext => (
            <div key={ext} className="sm:surface-card sm:overflow-hidden">
              <div className="flex items-center gap-2.5 mb-2 sm:mb-0 sm:px-4 sm:py-2.5 sm:bg-white/[0.02] sm:border-b sm:border-white/[0.06]">
                <h3 className="text-[13px] font-medium text-slate-300" style={{ letterSpacing: 0 }}>
                  {sectionTitle(ext)}
                </h3>
                <span className="text-[11px] text-slate-500">· {countBn(groups[ext].length, 'অপশন')}</span>
              </div>

              {/* Column headings: table layout only. */}
              <div
                className="hidden sm:grid grid-cols-[auto_minmax(0,1fr)_88px_88px_128px] items-center gap-4 px-4 py-2 border-b border-white/[0.05] text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"
                aria-hidden="true"
              >
                <span className="w-10" />
                <span>কোয়ালিটি</span>
                <span>বিবরণ</span>
                <span>সাইজ</span>
                <span className="text-right">&nbsp;</span>
              </div>

              <ul className="space-y-2 sm:space-y-0" aria-label={sectionTitle(ext)}>
                {groups[ext].map(format => (
                  <FormatRow
                    key={format.format_id}
                    format={format}
                    state={rows[format.format_id] ?? IDLE}
                    badge={badges[format.format_id]}
                    locked={activeId !== null && activeId !== format.format_id}
                    blockedReason={blockedReason}
                    onDownload={onDownload}
                    onCancel={onCancel}
                    onReport={onReport}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        সাইজগুলো আনুমানিক। শুধু সম্পূর্ণ ডাউনলোড দৈনিক সীমায় গোনা হয় — বাতিল বা ব্যর্থ ডাউনলোড গোনা হয় না। শুধু
        সেসব ভিডিও ডাউনলোড করুন যেগুলো রাখার অধিকার আপনার আছে।
      </p>
    </section>
  )
}

export default FormatMatrix
