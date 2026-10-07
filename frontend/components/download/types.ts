// components/download/types.ts
import type { DownloadProgressEvent, VideoFormat } from '@/lib/api'

/** What one format row shows: its download, if any. */
export type RowState =
  | { status: 'idle' }
  | { status: 'active'; progress: DownloadProgressEvent }
  | { status: 'complete' }
  /** `retryable` is false when trying again cannot help (limit reached, link refused). */
  | { status: 'error'; message: string; retryable: boolean }

export const IDLE: RowState = { status: 'idle' }

/** Container extensions listed as video; everything else is audio. */
export const VIDEO_EXTS = ['mp4', 'webm', 'mkv', 'mov', 'avi'] as const

export function isVideoExt(ext: string): boolean {
  return (VIDEO_EXTS as readonly string[]).includes(ext.toLowerCase())
}

/**
 * What people see for a quality: "1080p Full HD", or "Audio only (MP3)".
 * The API's labels also name the video codec ("1080p Full HD · H.264") and
 * the audio bitrate; neither helps anyone choose, so they're left out here
 * (the bitrate still shows in the details).
 */
export function formatName(format: VideoFormat): string {
  if (format.type === 'audio' || !isVideoExt(format.ext)) return `Audio only (${format.ext.toUpperCase()})`
  const label = format.label.replace(/\s*·\s*(?:H\.?264|H\.?265|HEVC|VP0?9|AV0?1)\s*$/i, '').trim()
  return label || format.resolution || format.ext.toUpperCase()
}

/** Height in pixels from a video resolution like "1080p"; null when unknown. Video formats only ("128kbps" is audio). */
export function heightOf(resolution: string | null | undefined): number | null {
  const value = parseInt(resolution ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * The link inside pasted text. Share sheets often copy "Watch this! https://…",
 * so take the first http(s) URL when there is one, minus trailing punctuation.
 */
export function extractLink(text: string): string {
  const trimmed = text.trim()
  const match = /https?:\/\/[^\s<>"']+/i.exec(trimmed)
  return match ? match[0].replace(/[),.;:!?]+$/, '') : trimmed
}
