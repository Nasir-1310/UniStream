// components/ui/EmptyState.tsx
import type { ReactNode } from 'react'
import { Inbox, type LucideIcon } from 'lucide-react'

export interface EmptyStateProps {
  /** A lucide icon component (default Inbox) or any node. */
  icon?: LucideIcon | ReactNode
  title: string
  description?: ReactNode
  /** Call to action, e.g. a "Clear filters" button. */
  action?: ReactNode
  /** Less padding, for use inside cards and tables. */
  compact?: boolean
  className?: string
}

function isComponent(value: unknown): value is LucideIcon {
  // lucide icons are forwardRef objects; plain function components also qualify.
  return typeof value === 'function' || (typeof value === 'object' && value !== null && '$$typeof' in value && 'render' in value)
}

/** Friendly placeholder for empty lists and "no results" states. */
export function EmptyState({ icon = Inbox, title, description, action, compact, className = '' }: EmptyStateProps) {
  let iconNode: ReactNode = icon as ReactNode
  if (isComponent(icon)) {
    const Icon = icon
    iconNode = <Icon className="w-5 h-5 text-slate-400" aria-hidden="true" />
  }
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8 px-4' : 'py-14 px-6'} ${className}`}>
      <div className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-3">
        {iconNode}
      </div>
      <p className="text-sm font-semibold text-slate-200">{title}</p>
      {description && <div className="mt-1 text-[13px] text-slate-500 max-w-sm leading-relaxed">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export default EmptyState
