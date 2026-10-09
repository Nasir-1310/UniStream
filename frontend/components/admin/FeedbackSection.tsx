'use client'
// components/admin/FeedbackSection.tsx
//
// Problem reports and feedback that users sent from the download page
// ("Report a problem / Feedback", or "Report this problem" on a failed
// download, which adds the link, quality and error). Mark them done once
// handled, or delete them. Until the feedback table exists in Supabase the
// section shows the SQL that creates it.

import { useState } from 'react'
import { Bug, Check, ExternalLink, Lightbulb, MessageSquareHeart, RotateCcw, Trash2 } from 'lucide-react'
import { Alert, Badge, EmptyState, Pagination, useConfirm, useToast, type BadgeTone } from '@/components/ui'
import {
  adminDeleteFeedback,
  adminListFeedback,
  adminSetFeedbackStatus,
  type FeedbackItem,
  type FeedbackKind,
} from '@/lib/api'
import { formatDate, formatRelative } from '@/lib/format'
import { useAdmin } from './AdminContext'
import { useAdminQuery, useBusy } from './hooks'
import { CopyButton, QueryError, SectionHeader, SkeletonRows } from './parts'

const PAGE_SIZE = 25

const FILTERS: { id: 'all' | 'new' | 'done'; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'done', label: 'Done' },
  { id: 'all', label: 'All' },
]

const KIND: Record<FeedbackKind, { label: string; tone: BadgeTone; Icon: typeof Bug }> = {
  problem: { label: 'Problem', tone: 'danger', Icon: Bug },
  feedback: { label: 'Feedback', tone: 'info', Icon: MessageSquareHeart },
  idea: { label: 'Idea', tone: 'brand', Icon: Lightbulb },
}

/** Only open http(s) links (users type whatever they like). */
function safeHref(url: string | null): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined
}

export function FeedbackSection() {
  const { reportError } = useAdmin()
  const toast = useToast()
  const confirm = useConfirm()
  const { busy, run } = useBusy()
  const [filter, setFilter] = useState<'all' | 'new' | 'done'>('new')
  const [page, setPage] = useState(1)

  const query = useAdminQuery(`feedback:${filter}:${page}`, () =>
    adminListFeedback({ status: filter === 'all' ? undefined : filter, page, page_size: PAGE_SIZE }),
  )
  const data = query.data

  const setStatus = async (item: FeedbackItem, status: 'new' | 'done') => {
    try {
      await run(item.id, status === 'done' ? 'Marking done…' : 'Reopening…', () => adminSetFeedbackStatus(item.id, status))
      toast.success(status === 'done' ? 'Marked as done' : 'Marked as new')
      query.reload()
    } catch (err) {
      reportError(err, 'Couldn’t update this message')
    }
  }

  const remove = async (item: FeedbackItem) => {
    const ok = await confirm({
      title: 'Delete this message?',
      message: <span className="block text-white break-words">{item.message.slice(0, 200)}</span>,
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await run(item.id, 'Deleting…', () => adminDeleteFeedback(item.id))
      toast.success('Message deleted')
      if (data && data.items.length === 1 && page > 1) setPage(page - 1)
      else query.reload()
    } catch (err) {
      reportError(err, 'Couldn’t delete this message')
    }
  }

  return (
    <>
      <SectionHeader
        id="feedback"
        title="Feedback"
        description="Problems and ideas users sent from the download page. Use them to plan the next version."
        actions={
          <div className="inline-flex rounded-xl border border-white/[0.08] p-0.5" role="group" aria-label="Show">
            {FILTERS.map(item => (
              <button
                key={item.id}
                type="button"
                aria-pressed={filter === item.id}
                onClick={() => {
                  setFilter(item.id)
                  setPage(1)
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${
                  filter === item.id ? 'bg-indigo-500/20 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {item.label}
                {item.id === 'new' && data?.new ? ` (${data.new})` : ''}
              </button>
            ))}
          </div>
        }
      />

      {query.error && !data ? (
        <QueryError message={query.error} onRetry={query.reload} />
      ) : !data ? (
        <SkeletonRows count={4} className="h-28" />
      ) : !data.ready ? (
        <Alert tone="warning" title="One step left: create the feedback table in Supabase">
          <p>
            Open Supabase → SQL Editor → New query, paste this SQL and press Run. The rest of the site already works;
            only feedback waits for this.
          </p>
          <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-black/30 p-3 text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap">
            {data.setup_sql}
          </pre>
          <div className="mt-2 flex gap-2">
            <CopyButton text={data.setup_sql ?? ''} label="Copy SQL" />
            <button type="button" onClick={query.reload} className="btn-outline btn-sm">
              I ran it — check again
            </button>
          </div>
        </Alert>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={MessageSquareHeart}
          title={filter === 'new' ? 'Nothing new' : 'No messages yet'}
          description="Users can write from the download page with “Report a problem / Feedback”."
        />
      ) : (
        <div className={`space-y-3 ${query.stale ? 'opacity-60' : ''}`}>
          <ul className="space-y-3">
            {data.items.map(item => {
              const kind = KIND[item.kind] ?? KIND.feedback
              const href = safeHref(item.url)
              const working = busy[item.id]
              return (
                <li key={item.id} className="surface-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={kind.tone}>
                      <kind.Icon className="w-3 h-3" aria-hidden="true" />
                      {kind.label}
                    </Badge>
                    {item.status === 'new' ? <Badge tone="warning">New</Badge> : <Badge tone="success">Done</Badge>}
                    <span className="text-xs text-slate-400">{item.identifier || 'Unknown user'}</span>
                    <span className="text-xs text-slate-500" title={item.created_at ? formatDate(item.created_at) : undefined}>
                      · {item.created_at ? formatRelative(item.created_at) : ''}
                    </span>
                  </div>
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-200 whitespace-pre-wrap break-words">{item.message}</p>
                  {item.url && (
                    <p className="mt-2 text-xs break-all">
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200">
                          <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          {item.url}
                        </a>
                      ) : (
                        <span className="text-slate-400">{item.url}</span>
                      )}
                    </p>
                  )}
                  {item.details && (
                    <p className="mt-2 rounded-lg bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-slate-400 break-words">
                      {item.details}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.status === 'new' ? (
                      <button type="button" disabled={Boolean(working)} onClick={() => setStatus(item, 'done')} className="btn-outline btn-sm">
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        {working || 'Mark done'}
                      </button>
                    ) : (
                      <button type="button" disabled={Boolean(working)} onClick={() => setStatus(item, 'new')} className="btn-outline btn-sm">
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        {working || 'Mark as new'}
                      </button>
                    )}
                    <button type="button" disabled={Boolean(working)} onClick={() => remove(item)} className="btn-ghost btn-sm text-red-300">
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={data.total}
            onPageChange={setPage}
            disabled={query.loading}
            itemLabel="messages"
          />
        </div>
      )}
    </>
  )
}

export default FeedbackSection
