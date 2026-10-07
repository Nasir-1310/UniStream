'use client'
// components/admin/LogsSection.tsx
//
// Completed downloads, newest first: filter by text, platform, user and
// date range; delete single rows or the selected page rows; purge old logs
// in bulk; export what the filters match as CSV.

import { useState } from 'react'
import { Download, Eraser, ExternalLink, FileDown, ScrollText, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { EmptyState, Pagination, PlatformBadge, Spinner, useConfirm, useToast } from '@/components/ui'
import {
  adminDeleteLog,
  adminDeleteLogs,
  adminExportLogs,
  adminListLogs,
  type LogEntry,
  type LogFilters,
} from '@/lib/api'
import { EMPTY, formatBytes, formatDate, formatRelative, pluralize, toDateInputValue } from '@/lib/format'
import { PLATFORMS, PLATFORM_LABELS } from '@/lib/validation'
import { useAdmin, type NavigationIntent } from './AdminContext'
import { useAdminQuery, useBusy, useDebouncedValue } from './hooks'
import { Checkbox, QueryError, SectionHeader, SkeletonRows } from './parts'
import { PurgeLogsDialog } from './PurgeLogsDialog'

type LogsIntent = Extract<NavigationIntent, { section: 'logs' }>

const PAGE_SIZES = [25, 50, 100, 200]

const PRESETS: { id: string; label: string; days: number | null }[] = [
  { id: 'today', label: 'Today', days: 0 },
  { id: '7', label: '7 days', days: 6 },
  { id: '30', label: '30 days', days: 29 },
  { id: 'all', label: 'All time', days: null },
]

/**
 * "YYYY-MM-DD" `days` before today in the app's timezone — the API reads
 * date filters as whole days there, so "Today" must mean Dhaka's today even
 * on a laptop set to another zone.
 */
function daysAgo(days: number, timeZone: string): string {
  const date = new Date(Date.now() - days * 86_400_000)
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  } catch {
    return toDateInputValue(date)
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Only open http(s) links from the log (rows store whatever URL was submitted). */
function safeHref(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined
}

export function LogsSection({ intent }: { intent?: LogsIntent }) {
  const { secret, revisions, invalidate, reportError, overview } = useAdmin()
  const timeZone = overview?.system.timezone || 'Asia/Dhaka'
  const toast = useToast()
  const confirm = useConfirm()
  const { busy, run } = useBusy()

  const [search, setSearch] = useState(intent?.q ?? '')
  const [platform, setPlatform] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [user, setUser] = useState<{ id: string; label: string } | null>(
    intent?.userId ? { id: intent.userId, label: intent.userLabel ?? 'Selected user' } : null,
  )
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [purgeOpen, setPurgeOpen] = useState(false)
  // Phones: platform and dates fold away behind a "Filters" button.
  const [moreFilters, setMoreFilters] = useState(false)
  const q = useDebouncedValue(search.trim(), 350)

  const rangeInvalid = Boolean(dateFrom && dateTo && dateFrom > dateTo)
  const filters: LogFilters = {
    q: q || undefined,
    platform: platform || undefined,
    user_id: user?.id,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  }
  const filterKey = `${q}|${platform}|${user?.id ?? ''}|${dateFrom}|${dateTo}`
  const filtered = filterKey !== '||||'
  const extraFilters = (platform ? 1 : 0) + (dateFrom || dateTo ? 1 : 0)

  const query = useAdminQuery(
    `logs|${filterKey}|${page}|${pageSize}|${revisions.logs}`,
    s => adminListLogs(s, { ...filters, page, page_size: pageSize }),
    { enabled: !rangeInvalid },
  )
  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0

  // Selection: rows on the current page of the current filter.
  const scope = `${filterKey}|${page}|${pageSize}`
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope: '', ids: [] })
  const visibleIds = items.map(log => log.id)
  const selectedIds = selection.scope === scope ? selection.ids.filter(id => visibleIds.includes(id)) : []
  const allSelected = items.length > 0 && selectedIds.length === items.length
  const toggle = (id: string, on: boolean) =>
    setSelection({ scope, ids: on ? [...selectedIds, id] : selectedIds.filter(other => other !== id) })
  const toggleAll = (on: boolean) => setSelection({ scope, ids: on ? visibleIds : [] })

  const resetPage = () => setPage(1)
  const afterDelete = (count: number) => {
    if (page > 1 && count >= items.length) setPage(current => Math.max(1, current - 1))
    invalidate('logs')
  }

  const deleteOne = async (log: LogEntry) => {
    const ok = await confirm({
      title: 'Delete this log?',
      message: (
        <>
          <span className="block text-white break-words">{log.title || log.url}</span>
          <span className="mt-1 block text-slate-400">
            {log.identifier} · {formatDate(log.created_at)}
          </span>
          <span className="mt-2 block">The user’s download counts are not affected.</span>
        </>
      ),
      confirmLabel: 'Delete log',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await run(log.id, 'Deleting…', () => adminDeleteLog(secret, log.id))
      toast.success('Log deleted')
      afterDelete(1)
    } catch (err) {
      reportError(err, 'Could not delete the log')
    }
  }

  const deleteSelected = async () => {
    const count = selectedIds.length
    if (!count) return
    const ok = await confirm({
      title: `Delete ${pluralize(count, 'log')}?`,
      message: 'The selected download records are removed permanently. Users’ download counts are not affected.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    try {
      const { deleted } = await run('bulk', 'Deleting…', () => adminDeleteLogs(secret, selectedIds))
      toast.success(`Deleted ${pluralize(deleted, 'log')}`)
      setSelection({ scope, ids: [] })
      afterDelete(count)
    } catch (err) {
      reportError(err, 'Could not delete the selected logs')
    }
  }

  const exportCsv = async () => {
    try {
      await run('export', 'Exporting…', () =>
        adminExportLogs(secret, { ...filters, date_from: rangeInvalid ? undefined : filters.date_from, date_to: rangeInvalid ? undefined : filters.date_to }),
      )
      toast.success('Export ready', { description: 'The CSV file was saved to your downloads (up to 50,000 rows).' })
    } catch (err) {
      reportError(err, 'Could not export the logs')
    }
  }

  const applyPreset = (days: number | null) => {
    setDateFrom(days === null ? '' : daysAgo(days, timeZone))
    setDateTo(days === null ? '' : daysAgo(0, timeZone))
    resetPage()
  }
  const activePreset = PRESETS.find(preset =>
    preset.days === null ? !dateFrom && !dateTo : dateFrom === daysAgo(preset.days, timeZone) && dateTo === daysAgo(0, timeZone),
  )?.id

  const clearFilters = () => {
    setSearch('')
    setPlatform('')
    setDateFrom('')
    setDateTo('')
    setUser(null)
    resetPage()
  }

  const exporting = Boolean(busy.export)
  const bulkBusy = Boolean(busy.bulk)

  return (
    <section aria-labelledby="admin-h-logs">
      <SectionHeader
        id="logs"
        title="Download logs"
        description={
          query.data
            ? `${pluralize(total, filtered ? 'matching download' : 'download')} recorded${filtered ? '' : ' in total'}.`
            : 'Every completed download, newest first.'
        }
        actions={
          <>
            <button type="button" onClick={exportCsv} disabled={exporting || total === 0} className="btn-outline">
              {exporting ? <Spinner size="sm" label={null} /> : <FileDown className="w-4 h-4" aria-hidden="true" />}
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
            <button type="button" onClick={() => setPurgeOpen(true)} className="btn-outline text-red-300 hover:text-red-200">
              <Eraser className="w-4 h-4" aria-hidden="true" />
              Delete old logs
            </button>
          </>
        }
      />

      {/* Filters */}
      <div className="surface-card p-3 sm:p-4 mb-4 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <label htmlFor="logs-search" className="sr-only">
              Search logs
            </label>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
            <input
              id="logs-search"
              type="search"
              value={search}
              onChange={e => {
                setSearch(e.target.value)
                resetPage()
              }}
              placeholder="Search title, link or user"
              autoComplete="off"
              spellCheck={false}
              className="input-field pl-10 pr-10 py-2.5"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  resetPage()
                }}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 btn-icon"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setMoreFilters(v => !v)}
            aria-expanded={moreFilters}
            aria-controls="logs-more-filters"
            className="sm:hidden btn-outline justify-between"
          >
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
              Platform & dates
            </span>
            {extraFilters > 0 && (
              <span className="rounded-full bg-indigo-500/20 px-2 text-[11px] font-semibold text-indigo-200">{extraFilters} on</span>
            )}
          </button>
          <div id="logs-more-filters" className={`${moreFilters ? '' : 'max-sm:hidden'} sm:w-44`}>
            <label htmlFor="logs-platform" className="sr-only">
              Platform
            </label>
            <select
              id="logs-platform"
              value={platform}
              onChange={e => {
                setPlatform(e.target.value)
                resetPage()
              }}
              className="input-field py-2.5"
            >
              <option value="">All platforms</option>
              {PLATFORMS.map(key => (
                <option key={key} value={PLATFORM_LABELS[key]}>
                  {PLATFORM_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={`${moreFilters ? '' : 'max-sm:hidden'} flex flex-col gap-3 lg:flex-row lg:items-end`}>
          <div className="grid grid-cols-2 gap-2 lg:w-[22rem]">
            <div>
              <label htmlFor="logs-from" className="block mb-1 text-xs text-slate-400">
                From
              </label>
              <input
                id="logs-from"
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={e => {
                  setDateFrom(e.target.value)
                  resetPage()
                }}
                aria-invalid={rangeInvalid ? true : undefined}
                className="input-field py-2 [color-scheme:dark]"
              />
            </div>
            <div>
              <label htmlFor="logs-to" className="block mb-1 text-xs text-slate-400">
                To
              </label>
              <input
                id="logs-to"
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={e => {
                  setDateTo(e.target.value)
                  resetPage()
                }}
                aria-invalid={rangeInvalid ? true : undefined}
                className="input-field py-2 [color-scheme:dark]"
              />
            </div>
          </div>
          <div role="group" aria-label="Date range presets" className="flex flex-wrap gap-1.5">
            {PRESETS.map(preset => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={activePreset === preset.id}
                onClick={() => applyPreset(preset.days)}
                className={`h-10 rounded-lg border px-3 text-[13px] font-medium transition-colors ${
                  activePreset === preset.id
                    ? 'border-indigo-500/40 bg-indigo-500/15 text-white'
                    : 'border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {(user || filtered || rangeInvalid) && (
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            {user && (
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 pl-3 pr-1 text-[13px] text-indigo-100">
                User: <span className="max-w-[12rem] truncate font-medium">{user.label}</span>
                <button
                  type="button"
                  onClick={() => {
                    setUser(null)
                    resetPage()
                  }}
                  aria-label="Show all users"
                  className="w-8 h-8 inline-flex items-center justify-center rounded-full hover:bg-white/10"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </span>
            )}
            {rangeInvalid && <span className="text-xs text-red-400">The start date must be on or before the end date.</span>}
            {filtered && (
              <button type="button" onClick={clearFilters} className="btn-ghost btn-sm px-2 text-indigo-300 hover:text-indigo-200">
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      {query.error && (
        <div className="mb-4">
          <QueryError message={query.error} onRetry={query.reload} title="Could not load the logs" />
        </div>
      )}

      <div className="surface-card overflow-hidden">
        {!query.data ? (
          query.error || rangeInvalid ? null : (
            <div className="p-4">
              <SkeletonRows count={6} className="h-14" />
            </div>
          )
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={Search}
              title="No logs match these filters"
              action={
                <button type="button" onClick={clearFilters} className="btn-outline">
                  Clear filters
                </button>
              }
            />
          ) : total > 0 ? (
            <EmptyState
              icon={ScrollText}
              title="This page is empty"
              action={
                <button type="button" onClick={resetPage} className="btn-outline">
                  Go to the first page
                </button>
              }
            />
          ) : (
            <EmptyState icon={Download} title="No downloads yet" description="Each completed download appears here with the user, link and quality." />
          )
        ) : (
          <div className={`transition-opacity ${query.stale ? 'opacity-60' : ''}`} aria-busy={query.loading}>
            <LogsTable
              items={items}
              selectedIds={selectedIds}
              allSelected={allSelected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              busy={busy}
              onDelete={deleteOne}
              onFilterUser={log => {
                if (!log.user_id) return
                setUser({ id: log.user_id, label: log.identifier })
                resetPage()
              }}
            />
          </div>
        )}

        {query.data && total > 0 && (
          <div className="border-t border-white/[0.06] px-4 sm:px-5 py-3">
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={next => {
                setPage(next)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              pageSizeOptions={PAGE_SIZES}
              onPageSizeChange={size => {
                setPageSize(size)
                resetPage()
              }}
              disabled={query.loading}
              itemLabel="logs"
            />
          </div>
        )}
      </div>

      {selectedIds.length > 0 && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-4 z-20 mt-3">
          <div
            role="region"
            aria-label="Bulk actions"
            className="flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-500/30 bg-[#151829]/95 backdrop-blur-md px-3 py-2.5 shadow-2xl shadow-black/50"
          >
            <p className="mr-auto pl-1 text-[13px] text-slate-200" aria-live="polite">
              <span className="font-semibold text-white">{selectedIds.length}</span> selected
            </p>
            <button type="button" disabled={bulkBusy} onClick={deleteSelected} className="btn-outline text-red-300 hover:text-red-200">
              {bulkBusy ? <Spinner size="sm" label={null} /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
              Delete selected
            </button>
            <button
              type="button"
              onClick={() => setSelection({ scope, ids: [] })}
              className="btn-icon"
              aria-label="Clear selection"
              title="Clear selection"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      <PurgeLogsDialog open={purgeOpen} onClose={() => setPurgeOpen(false)} totalLogs={filtered ? null : query.data ? total : null} />
    </section>
  )
}

// ── Rows ──────────────────────────────────────────────────────────────────────

interface LogsTableProps {
  items: LogEntry[]
  selectedIds: string[]
  allSelected: boolean
  onToggle: (id: string, on: boolean) => void
  onToggleAll: (on: boolean) => void
  busy: Record<string, string>
  onDelete: (log: LogEntry) => void
  onFilterUser: (log: LogEntry) => void
}

function LogMeta({ log }: { log: LogEntry }) {
  const parts = [log.quality, log.file_size ? formatBytes(log.file_size) : null, hostOf(log.url)].filter(Boolean)
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
      {log.platform && <PlatformBadge platform={log.platform} />}
      {parts.map((part, index) => (
        <span key={index} className="whitespace-nowrap">
          {part}
        </span>
      ))}
    </div>
  )
}

function LogTitle({ log }: { log: LogEntry }) {
  const href = safeHref(log.url)
  const title = log.title?.trim() || 'Untitled video'
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="block truncate text-sm font-medium text-white hover:text-indigo-200 hover:underline underline-offset-2"
      title={title}
    >
      {title}
    </a>
  ) : (
    <p className="truncate text-sm font-medium text-white" title={title}>
      {title}
    </p>
  )
}

function LogUser({ log, onFilterUser }: { log: LogEntry; onFilterUser: (log: LogEntry) => void }) {
  if (!log.user_id) {
    return (
      <span className="block truncate text-[13px] text-slate-400" title="The account was deleted or predates user accounts">
        {log.identifier || EMPTY}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onFilterUser(log)}
      className="block max-w-full truncate text-left text-[13px] text-slate-300 hover:text-indigo-200 hover:underline underline-offset-2"
      title="Show only this user’s downloads"
    >
      {log.identifier}
    </button>
  )
}

function RowButtons({ log, busy, onDelete }: { log: LogEntry; busy: Record<string, string>; onDelete: (log: LogEntry) => void }) {
  const href = safeHref(log.url)
  return (
    <div className="flex items-center justify-end gap-1">
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="btn-icon" aria-label="Open video link" title="Open video link">
          <ExternalLink className="w-4 h-4" aria-hidden="true" />
        </a>
      )}
      <button
        type="button"
        onClick={() => onDelete(log)}
        disabled={Boolean(busy[log.id]) || Boolean(busy.bulk)}
        className="btn-icon hover:!text-red-300 hover:!bg-red-500/10"
        aria-label="Delete log"
        title="Delete log"
      >
        {busy[log.id] ? <Spinner size="sm" label={null} /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
      </button>
    </div>
  )
}

function LogsTable({ items, selectedIds, allSelected, onToggle, onToggleAll, busy, onDelete, onFilterUser }: LogsTableProps) {
  return (
    <>
      {/* md and up */}
      <table className="hidden md:table w-full table-fixed text-left">
        <caption className="sr-only">Download logs</caption>
        <thead>
          <tr className="border-b border-white/[0.06] text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            <th scope="col" className="w-12 py-3 pl-5 pr-1">
              <Checkbox
                checked={allSelected}
                indeterminate={selectedIds.length > 0 && !allSelected}
                onChange={onToggleAll}
                label="Select all logs on this page"
              />
            </th>
            <th scope="col" className="py-3 px-3">Video</th>
            <th scope="col" className="w-[24%] py-3 px-3">User</th>
            <th scope="col" className="w-[150px] py-3 px-3">When</th>
            <th scope="col" className="w-[100px] py-3 pl-3 pr-5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {items.map(log => {
            const selected = selectedIds.includes(log.id)
            return (
              <tr key={log.id} className={selected ? 'bg-indigo-500/[0.06]' : 'hover:bg-white/[0.02]'}>
                <td className="py-3 pl-5 pr-1 align-top pt-4">
                  <Checkbox checked={selected} onChange={on => onToggle(log.id, on)} label={`Select log: ${log.title || log.url}`} />
                </td>
                <td className="py-3 px-3 min-w-0">
                  <LogTitle log={log} />
                  <LogMeta log={log} />
                </td>
                <td className="py-3 px-3 min-w-0">
                  <LogUser log={log} onFilterUser={onFilterUser} />
                </td>
                <td className="py-3 px-3">
                  <p className="text-[13px] text-slate-300">{formatRelative(log.created_at)}</p>
                  <p className="text-[11px] text-slate-500">{formatDate(log.created_at)}</p>
                </td>
                <td className="py-3 pl-3 pr-5">
                  <RowButtons log={log} busy={busy} onDelete={onDelete} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Phones */}
      <div className="md:hidden">
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-2.5">
          <Checkbox
            checked={allSelected}
            indeterminate={selectedIds.length > 0 && !allSelected}
            onChange={onToggleAll}
            label="Select all logs on this page"
          />
          <span className="text-xs text-slate-500">Select all on this page</span>
        </div>
        <ul className="divide-y divide-white/[0.06]">
          {items.map(log => {
            const selected = selectedIds.includes(log.id)
            return (
              <li key={log.id} className={`flex items-start gap-3 px-4 py-3.5 ${selected ? 'bg-indigo-500/[0.06]' : ''}`}>
                <div className="pt-2">
                  <Checkbox checked={selected} onChange={on => onToggle(log.id, on)} label={`Select log: ${log.title || log.url}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <LogTitle log={log} />
                  <LogMeta log={log} />
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500 min-w-0">
                    <span className="min-w-0 flex-1">
                      <LogUser log={log} onFilterUser={onFilterUser} />
                    </span>
                    <span className="flex-shrink-0" title={formatDate(log.created_at)}>
                      {formatRelative(log.created_at)}
                    </span>
                  </div>
                </div>
                <div className="-mr-2 flex-shrink-0">
                  <RowButtons log={log} busy={busy} onDelete={onDelete} />
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}

