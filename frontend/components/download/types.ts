// components/download/types.ts
import type { DownloadProgressEvent } from '@/lib/api'

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
