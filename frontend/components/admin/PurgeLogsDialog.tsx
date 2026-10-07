'use client'
// components/admin/PurgeLogsDialog.tsx
//
// Delete old download logs in bulk, oldest first, so a busy launch can't
// fill the free database tier. "Everything" needs the word DELETE typed.

import { useState, type FormEvent } from 'react'
import { Eraser } from 'lucide-react'
import { Alert, Modal, Spinner, useToast } from '@/components/ui'
import { adminPurgeLogs, apiErrorMessage, type PurgeRequest } from '@/lib/api'
import { formatDate, formatNumber, pluralize, toDateInputValue } from '@/lib/format'
import { useAdmin } from './AdminContext'

type Choice = 'd7' | 'd30' | 'd90' | 'before' | 'all'

const CHOICES: { id: Choice; label: string; hint: string }[] = [
  { id: 'd7', label: 'Older than 7 days', hint: 'Keep the last week' },
  { id: 'd30', label: 'Older than 30 days', hint: 'Keep the last month' },
  { id: 'd90', label: 'Older than 90 days', hint: 'Keep the last three months' },
  { id: 'before', label: 'Before a date', hint: 'Remove logs from before the day you pick' },
  { id: 'all', label: 'Everything', hint: 'Delete every log' },
]

const DAYS: Partial<Record<Choice, number>> = { d7: 7, d30: 30, d90: 90 }
const FORM_ID = 'admin-purge-logs-form'
const CONFIRM_WORD = 'DELETE'

function daysAgo(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date
}

function initialState() {
  return { choice: 'd30' as Choice, before: toDateInputValue(daysAgo(30)), typed: '' }
}

export function PurgeLogsDialog({ open, onClose, totalLogs }: { open: boolean; onClose: () => void; totalLogs: number | null }) {
  const { secret, handleAuthError, invalidate } = useAdmin()
  const toast = useToast()
  const [form, setForm] = useState(initialState)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { choice, before, typed } = form

  const close = () => {
    if (busy) return
    setForm(initialState())
    setError(null)
    onClose()
  }

  const change = (patch: Partial<typeof form>) => {
    setForm(current => ({ ...current, ...patch }))
    setError(null)
  }

  const body: PurgeRequest | null =
    choice === 'all'
      ? typed.trim() === CONFIRM_WORD
        ? { all: true }
        : null
      : choice === 'before'
      ? before
        ? { before }
        : null
      : { older_than_days: DAYS[choice] ?? 30 }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!body || busy) return
    setBusy(true)
    setError(null)
    try {
      const { deleted } = await adminPurgeLogs(secret, body)
      invalidate('logs')
      setBusy(false)
      setForm(initialState())
      onClose()
      toast.success(deleted ? `Deleted ${pluralize(deleted, 'log')}` : 'No logs matched', {
        description: deleted ? 'Older download history has been removed.' : 'Nothing was old enough to delete.',
      })
    } catch (err) {
      setBusy(false)
      if (handleAuthError(err)) return
      setError(apiErrorMessage(err, 'Could not delete the logs.'))
    }
  }

  const days = DAYS[choice]
  const summary =
    choice === 'all'
      ? `Every download log${totalLogs !== null ? ` (${formatNumber(totalLogs)})` : ''} will be deleted.`
      : choice === 'before'
      ? before
        ? `Logs from before ${formatDate(`${before}T00:00:00`, { time: false })} will be deleted.`
        : 'Pick a date.'
      : `Logs from before ${formatDate(daysAgo(days ?? 30), { time: false })} will be deleted.`

  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={!busy}
      size="md"
      title="Delete old logs"
      description="Free up database space by removing old download records."
      icon={
        <div className="w-10 h-10 rounded-xl border border-red-500/25 bg-red-500/10 text-red-400 flex items-center justify-center">
          <Eraser className="w-5 h-5" aria-hidden="true" />
        </div>
      }
      footer={
        <>
          <button type="button" onClick={close} disabled={busy} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" form={FORM_ID} disabled={busy || !body} className="btn-danger">
            {busy && <Spinner size="sm" label={null} />}
            {busy ? 'Deleting…' : 'Delete logs'}
          </button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate>
        <fieldset disabled={busy} className="min-w-0">
          <legend className="sr-only">What to delete</legend>
          <div className="space-y-2">
            {CHOICES.map(option => {
              const checked = choice === option.id
              return (
                <label
                  key={option.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors has-[:focus-visible]:outline
                    has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-indigo-500/70 ${
                      checked
                        ? option.id === 'all'
                          ? 'border-red-500/50 bg-red-500/10'
                          : 'border-indigo-500/50 bg-indigo-500/10'
                        : 'border-white/10 hover:bg-white/[0.03]'
                    }`}
                >
                  <input
                    type="radio"
                    name="purge-choice"
                    value={option.id}
                    checked={checked}
                    data-autofocus={checked ? true : undefined}
                    onChange={() => change({ choice: option.id })}
                    className="mt-1 accent-indigo-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] font-semibold ${option.id === 'all' ? 'text-red-200' : 'text-white'}`}>
                      {option.label}
                    </span>
                    <span className="block text-xs text-slate-400">{option.hint}</span>
                  </span>
                </label>
              )
            })}
          </div>

          {choice === 'before' && (
            <div className="mt-3">
              <label htmlFor="purge-before" className="field-label">
                Delete logs before
              </label>
              <input
                id="purge-before"
                type="date"
                value={before}
                max={toDateInputValue()}
                onChange={e => change({ before: e.target.value })}
                className="input-field [color-scheme:dark]"
              />
            </div>
          )}

          {choice === 'all' && (
            <div className="mt-3">
              <label htmlFor="purge-confirm" className="field-label">
                Type <span className="font-mono font-semibold text-white">{CONFIRM_WORD}</span> to confirm
              </label>
              <input
                id="purge-confirm"
                value={typed}
                onChange={e => change({ typed: e.target.value })}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="input-field font-mono"
              />
            </div>
          )}
        </fieldset>

        <p className="mt-4 text-[13px] text-slate-300" aria-live="polite">
          {summary} This can’t be undone.
        </p>
        <p className="mt-1.5 text-xs text-slate-500">
          Users’ daily limits and all-time download counts are not affected. The Overview charts and the CSV export only
          cover logs that remain — export first if you need a copy.
        </p>

        {error && (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        )}
      </form>
    </Modal>
  )
}
