// components/ui/Badge.tsx
import type { ReactNode } from 'react'
import { Facebook, Instagram, Youtube, type LucideIcon } from 'lucide-react'
import type { UserStatus } from '@/lib/api'

export type BadgeTone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger'

const TONES: Record<BadgeTone, { badge: string; dot: string }> = {
  neutral: { badge: 'bg-white/[0.06] text-slate-300 border-white/10', dot: 'bg-slate-400' },
  brand: { badge: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30', dot: 'bg-indigo-400' },
  info: { badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30', dot: 'bg-sky-400' },
  success: { badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-400' },
  warning: { badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30', dot: 'bg-amber-400' },
  danger: { badge: 'bg-red-500/15 text-red-300 border-red-500/30', dot: 'bg-red-400' },
}

export interface BadgeProps {
  tone?: BadgeTone
  size?: 'sm' | 'md'
  /** Small colored dot before the text. */
  dot?: boolean
  icon?: ReactNode
  className?: string
  title?: string
  children: ReactNode
}

/** Small pill for statuses, counts and labels. */
export function Badge({ tone = 'neutral', size = 'sm', dot, icon, className = '', title, children }: BadgeProps) {
  const t = TONES[tone]
  const sizing = size === 'sm' ? 'text-[11px] px-2 py-0.5 gap-1' : 'text-xs px-2.5 py-1 gap-1.5'
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full border font-semibold leading-tight ${sizing} ${t.badge} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.dot}`} aria-hidden="true" />}
      {icon}
      {children}
    </span>
  )
}

const STATUS: Record<UserStatus, { tone: BadgeTone; label: string }> = {
  approved: { tone: 'success', label: 'Approved' },
  pending: { tone: 'warning', label: 'Pending' },
  blocked: { tone: 'danger', label: 'Blocked' },
}

/** Approved / Pending / Blocked badge for a user status (`label` overrides the English text). */
export function StatusBadge({ status, size = 'sm', label }: { status: UserStatus; size?: 'sm' | 'md'; label?: string }) {
  const s = STATUS[status] ?? { tone: 'neutral' as const, label: status }
  return (
    <Badge tone={s.tone} size={size} dot>
      {label ?? s.label}
    </Badge>
  )
}

interface PlatformStyle {
  label: string
  Icon: LucideIcon
  /** Text color for the icon/label. */
  color: string
  badge: string
}

const PLATFORM_STYLES: Record<string, PlatformStyle> = {
  youtube: { label: 'YouTube', Icon: Youtube, color: 'text-red-400', badge: 'bg-red-500/10 border-red-500/25 text-red-300' },
  facebook: { label: 'Facebook', Icon: Facebook, color: 'text-blue-400', badge: 'bg-blue-500/10 border-blue-500/25 text-blue-300' },
  instagram: { label: 'Instagram', Icon: Instagram, color: 'text-pink-400', badge: 'bg-pink-500/10 border-pink-500/25 text-pink-300' },
}

/** Style for a platform key or label ("youtube" / "YouTube"); undefined for others. */
export function platformStyle(platform: string | null | undefined): PlatformStyle | undefined {
  return PLATFORM_STYLES[(platform ?? '').toLowerCase()]
}

/** The platform's brand icon, or nothing for unknown platforms. */
export function PlatformIcon({ platform, className = 'w-3.5 h-3.5' }: { platform: string | null | undefined; className?: string }) {
  const style = platformStyle(platform)
  if (!style) return null
  const { Icon } = style
  return <Icon className={`${className} ${style.color} flex-shrink-0`} aria-hidden="true" />
}

/** Icon + name pill for YouTube / Facebook / Instagram (neutral pill for anything else). */
export function PlatformBadge({ platform, size = 'sm' }: { platform: string | null | undefined; size?: 'sm' | 'md' }) {
  const style = platformStyle(platform)
  const sizing = size === 'sm' ? 'text-[11px] px-2 py-0.5 gap-1' : 'text-xs px-2.5 py-1 gap-1.5'
  if (!style) {
    return <Badge size={size}>{platform || 'Unknown'}</Badge>
  }
  const { Icon } = style
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border font-semibold ${sizing} ${style.badge}`}>
      <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} aria-hidden="true" />
      {style.label}
    </span>
  )
}

export default Badge
