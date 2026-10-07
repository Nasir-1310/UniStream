'use client'
// components/admin/SystemSection.tsx
//
// Server health: which database is live and reachable, the v2 schema, the
// download toolchain, and the YouTube resolution check (which YouTube
// clients list which resolutions from this server's IP).

import { useState, type FormEvent } from 'react'
import { Activity, Clapperboard, Database, HardDrive, Play, RefreshCw } from 'lucide-react'
import { Alert, Badge, Spinner } from '@/components/ui'
import { adminGetStorage, adminYoutubeCheck, apiErrorMessage, type StorageHealth, type YoutubeCheckResult } from '@/lib/api'
import { EMPTY, formatDate, formatNumber } from '@/lib/format'
import { detectPlatform } from '@/lib/validation'
import { useAdmin } from './AdminContext'
import { useAdminQuery, useClock } from './hooks'
import { MigrationPanel } from './MigrationPanel'
import { Card, CheckRow, DetailList, QueryError, SectionHeader, SkeletonRows } from './parts'

export function SystemSection() {
  const { revisions } = useAdmin()
  const query = useAdminQuery(`storage|${revisions.system}|${revisions.users}|${revisions.logs}`, adminGetStorage)
  const storage = query.data

  return (
    <section aria-labelledby="admin-h-system">
      <SectionHeader
        id="system"
        title="System"
        description="Database, download tools and YouTube diagnostics."
        actions={
          <button type="button" onClick={query.reload} disabled={query.loading} className="btn-outline">
            {query.loading ? <Spinner size="sm" label={null} /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
            Re-check
          </button>
        }
      />

      {query.error && (
        <div className="mb-4">
          <QueryError message={query.error} onRetry={query.reload} title="Could not read the server status" />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 items-start">
        {storage ? (
          <>
            <StorageCard storage={storage} />
            <ToolsCard storage={storage} />
          </>
        ) : (
          !query.error && (
            <>
              <SkeletonRows count={1} className="h-64" />
              <SkeletonRows count={1} className="h-64" />
            </>
          )
        )}
        <Card title="Database schema" description="Tables and columns the v2 app needs" icon={Database} className="xl:col-span-2">
          <MigrationPanel compact />
        </Card>
        <YoutubeCheckCard storage={storage} />
      </div>
    </section>
  )
}

// ── Storage ───────────────────────────────────────────────────────────────────

function StorageCard({ storage }: { storage: StorageHealth }) {
  const supabase = storage.active_backend === 'supabase'
  const healthy = storage.reachable && storage.persistent
  const counts = storage.status_counts ?? null
  const activePath = typeof storage.active_db_path === 'string' ? storage.active_db_path : null
  const lastSuccess = typeof storage.last_remote_success === 'string' ? storage.last_remote_success : null

  return (
    <Card
      title="Database"
      description={supabase ? 'Supabase (Postgres)' : 'SQLite file on the server'}
      icon={HardDrive}
      actions={
        <Badge tone={healthy ? 'success' : storage.reachable ? 'warning' : 'danger'} dot>
          {healthy ? 'Healthy' : storage.reachable ? 'Not persistent' : 'Unreachable'}
        </Badge>
      }
    >
      {!storage.reachable && (
        <Alert tone="danger" className="mb-4" title="The database could not be reached">
          {storage.error || storage.last_remote_error || 'Sign-ins and downloads will fail until it is back.'}
        </Alert>
      )}
      {storage.reachable && !storage.persistent && (
        <Alert tone="warning" className="mb-4" title="Local development storage">
          SQLite is active. Accounts and logs can disappear on redeploy — configure Supabase before launch.
        </Alert>
      )}
      {storage.configuration_warning && (
        <Alert tone="warning" className="mb-4">
          {storage.configuration_warning}
        </Alert>
      )}
      <DetailList
        items={[
          ['Users', storage.user_count === null || storage.user_count === undefined ? EMPTY : formatNumber(storage.user_count)],
          [
            'By status',
            counts
              ? `${formatNumber(counts.approved ?? 0)} approved · ${formatNumber(counts.pending ?? 0)} pending · ${formatNumber(counts.blocked ?? 0)} blocked`
              : EMPTY,
          ],
          ['Download logs', storage.download_log_count === null || storage.download_log_count === undefined ? EMPTY : formatNumber(storage.download_log_count)],
          ['Schema', storage.schema ? (storage.schema.ready ? 'Up to date' : 'Upgrade required') : EMPTY],
          ...(supabase
            ? ([['Last successful query', lastSuccess ? formatDate(lastSuccess) : EMPTY]] as [string, string][])
            : ([['Database file', activePath ?? EMPTY]] as [string, string][])),
        ]}
      />
      {storage.reachable && storage.last_remote_error && (
        <p className="mt-3 text-xs text-slate-500 break-words">Last error: {storage.last_remote_error}</p>
      )}
    </Card>
  )
}

// ── Download toolchain ────────────────────────────────────────────────────────

const AUTH_LABELS: Record<string, string> = {
  base64_cookie_secret: 'Cookies (secret)',
  cookie_file: 'Cookie file',
  browser: 'Browser cookies',
  local_cookie_file: 'Local cookie file',
  not_configured: 'Not configured',
}

function ToolsCard({ storage }: { storage: StorageHealth }) {
  const auth = storage.youtube_auth ?? 'unknown'
  return (
    <Card title="Download tools" description="What every download depends on" icon={Clapperboard}>
      <ul className="divide-y divide-white/[0.05] -mt-2">
        <CheckRow ok={Boolean(storage.yt_dlp_version)} label={`yt-dlp ${storage.yt_dlp_version ?? 'unknown'}`} detail="Keep it current: platforms change often." />
        <CheckRow
          ok={Boolean(storage.ffmpeg_location)}
          label={storage.ffmpeg_location ? 'FFmpeg found' : 'FFmpeg not found'}
          detail={storage.ffmpeg_location || 'Needed to merge HD video and audio and to make MP3s.'}
        />
        <CheckRow
          ok={Boolean(storage.js_runtime)}
          warn
          label={storage.js_runtime ? 'JavaScript runtime (Deno) found' : 'JavaScript runtime (Deno) missing'}
          detail={storage.js_runtime || 'YouTube may list fewer resolutions without it.'}
        />
        <CheckRow
          ok={auth !== 'not_configured'}
          warn
          label={`YouTube sign-in: ${AUTH_LABELS[auth] ?? auth}`}
          detail={auth === 'not_configured' ? 'Some videos may need cookies to show every resolution from a data-centre IP.' : undefined}
        />
        <CheckRow ok label={`YouTube proxy: ${storage.youtube_proxy ?? 'unknown'}`} />
      </ul>
    </Card>
  )
}

// ── YouTube resolution check ──────────────────────────────────────────────────

interface ClientReport {
  heights?: number[]
  protocols?: string[]
  video_only_streams?: number
  error?: string
  notes?: string[]
}

function asReports(clients: unknown): [string, Record<string, ClientReport> | string][] {
  if (!clients || typeof clients !== 'object') return []
  return Object.entries(clients as Record<string, unknown>).map(([mode, value]) => [
    mode,
    typeof value === 'string' ? value : value && typeof value === 'object' ? (value as Record<string, ClientReport>) : String(value),
  ])
}

function YoutubeCheckCard({ storage }: { storage: StorageHealth | undefined }) {
  const { secret, handleAuthError } = useAdmin()
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [running, setRunning] = useState<number | null>(null)
  const [result, setResult] = useState<YoutubeCheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const now = useClock('second')
  const elapsed = running && now ? Math.max(0, Math.floor((now - running) / 1000)) : 0

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const target = url.trim()
    if (target && detectPlatform(target) !== 'youtube') {
      setUrlError('Enter a YouTube link, or leave it empty to use the default test video.')
      return
    }
    setUrlError(null)
    setError(null)
    setResult(null)
    setRunning(Date.now())
    try {
      setResult(await adminYoutubeCheck(secret, target || undefined))
    } catch (err) {
      if (!handleAuthError(err)) setError(apiErrorMessage(err, 'The YouTube check failed.'))
    } finally {
      setRunning(null)
    }
  }

  const reports = result ? asReports(result.clients) : []

  return (
    <Card
      title="YouTube resolution check"
      description="Which YouTube clients list which resolutions from this server"
      icon={Activity}
      className="xl:col-span-2"
    >
      {storage && (
        <p className="mb-4 text-xs text-slate-500 break-words">
          Sign-in: <span className="text-slate-300">{AUTH_LABELS[storage.youtube_auth ?? ''] ?? storage.youtube_auth ?? '?'}</span> · Proxy:{' '}
          <span className="text-slate-300">{storage.youtube_proxy ?? '?'}</span> · JS runtime:{' '}
          <span className="text-slate-300">{storage.js_runtime || 'missing'}</span> · yt-dlp{' '}
          <span className="text-slate-300">{storage.yt_dlp_version ?? '?'}</span>
        </p>
      )}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1">
          <label htmlFor="yt-check-url" className="sr-only">
            YouTube link to test (optional)
          </label>
          <input
            id="yt-check-url"
            type="url"
            inputMode="url"
            value={url}
            disabled={running !== null}
            onChange={e => {
              setUrl(e.target.value)
              setUrlError(null)
            }}
            placeholder="YouTube link (optional — a default test video is used)"
            aria-invalid={urlError ? true : undefined}
            aria-describedby={urlError ? 'yt-check-url-error' : undefined}
            className="input-field py-2.5"
          />
          {urlError && (
            <p id="yt-check-url-error" className="mt-1.5 text-xs text-red-400">
              {urlError}
            </p>
          )}
        </div>
        <button type="submit" disabled={running !== null} className="btn-primary btn-sm">
          {running !== null ? <Spinner size="sm" label={null} /> : <Play className="w-4 h-4" aria-hidden="true" />}
          {running !== null ? `Checking… ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : 'Run check'}
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-500" aria-live="polite">
        {running !== null ? 'Each client is probed separately — this usually takes 1–3 minutes. Keep this tab open.' : 'Takes 1–3 minutes.'}
      </p>

      {error && (
        <Alert tone="danger" className="mt-4" title="Check failed">
          {error}
        </Alert>
      )}

      {result && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-slate-500">
            Commit <span className="font-mono text-slate-300">{String(result.commit ?? '?')}</span> · yt-dlp{' '}
            <span className="text-slate-300">{String(result.yt_dlp_version ?? '?')}</span>
          </p>
          {reports.map(([mode, clients]) => (
            <div key={mode}>
              <h3 className="text-[13px] font-semibold text-white capitalize mb-2">{mode.replace(/_/g, ' ')}</h3>
              {typeof clients === 'string' ? (
                <p className="text-xs text-slate-500">{clients}</p>
              ) : (
                <ul className="divide-y divide-white/[0.05] rounded-xl border border-white/[0.07]">
                  {Object.entries(clients).map(([client, report]) => {
                    const heights = report.heights ?? []
                    const best = heights.length ? Math.max(...heights) : 0
                    return (
                      <li key={client} className="px-3.5 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[12px] text-slate-200">{client}</span>
                          {report.error ? (
                            <Badge tone="danger">Error</Badge>
                          ) : (
                            <Badge tone={best >= 1080 ? 'success' : best >= 720 ? 'info' : best > 0 ? 'warning' : 'neutral'}>
                              {best ? `up to ${best}p` : 'no video formats'}
                            </Badge>
                          )}
                        </div>
                        {heights.length > 0 && (
                          <p className="mt-1 text-xs text-slate-400 break-words">
                            {heights.map(h => `${h}p`).join(' · ')}
                            {report.protocols?.length ? <span className="text-slate-500"> — {report.protocols.join(', ')}</span> : null}
                          </p>
                        )}
                        {report.error && <p className="mt-1 text-xs text-red-300/90 break-words">{report.error}</p>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ))}
          <details className="rounded-xl border border-white/[0.07] bg-[#0b0d17]">
            <summary className="cursor-pointer select-none px-3.5 py-2.5 text-[13px] text-slate-300 hover:text-white">Raw report (JSON)</summary>
            <pre className="max-h-96 overflow-auto border-t border-white/[0.06] p-3.5 text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap break-all">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </Card>
  )
}
