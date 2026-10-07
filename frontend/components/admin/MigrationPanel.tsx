'use client'
// components/admin/MigrationPanel.tsx
//
// The one-time database upgrade script with copy + "Open SQL editor". Shown
// when the Supabase database is missing tables or columns the app needs, on
// the System page for reference, and on the first-sign-in setup screen
// (outside the dashboard, so the dashboard context is optional here).
// "Check again" re-reads the database status after the admin ran it.

import { Database, ExternalLink, RefreshCw } from 'lucide-react'
import { Alert, Spinner } from '@/components/ui'
import { adminGetSchema, type SchemaInfo } from '@/lib/api'
import { useOptionalAdmin } from './AdminContext'
import { useAdminQuery, type AdminQuery } from './hooks'
import { CopyButton, QueryError, SkeletonRows } from './parts'

// "_" lets Supabase ask which project to open, so no project id is needed here.
const SUPABASE_SQL_EDITOR = 'https://supabase.com/dashboard/project/_/sql/new'

export function MigrationPanel({
  compact = false,
  query: sharedQuery,
}: {
  compact?: boolean
  /** A schema query the parent already runs (avoids a second request). */
  query?: AdminQuery<SchemaInfo>
}) {
  const admin = useOptionalAdmin()
  const ownQuery = useAdminQuery('schema', adminGetSchema, { enabled: !sharedQuery })
  const query = sharedQuery ?? ownQuery
  const schema = query.data

  const recheck = () => {
    query.reload()
    // The overview's "upgrade needed" banner and the System page read the same status.
    admin?.invalidate('system')
  }

  if (!schema) {
    return query.error ? <QueryError message={query.error} onRetry={query.reload} /> : <SkeletonRows count={2} className="h-12" />
  }

  return (
    <div className="space-y-3">
      {schema.ready ? (
        <Alert tone="success" title="Database is up to date" live="off">
          Everything the app needs is in place. Running the script again is safe but not needed.
        </Alert>
      ) : (
        <div className="text-[13px] text-slate-300 space-y-2">
          <ol className="list-decimal pl-5 space-y-1 text-slate-300">
            <li>Copy the upgrade script.</li>
            <li>
              Open the{' '}
              <a href={SUPABASE_SQL_EDITOR} target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline underline-offset-2 hover:text-indigo-200">
                Supabase SQL editor
              </a>{' '}
              for your project, paste the script and press <span className="font-semibold text-white">Run</span>. It’s safe to run more than once.
            </li>
            <li>Come back here and press “Check again”.</li>
          </ol>
          {schema.missing.length > 0 && (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer select-none py-1 hover:text-slate-300">
                What’s missing ({schema.missing.length})
              </summary>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {schema.missing.map(item => (
                  <li key={item} className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[11px] text-slate-300">
                    {item}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <CopyButton text={schema.migration_sql} label="Copy SQL" copiedLabel="SQL copied" className="btn-primary btn-sm" />
        <a href={SUPABASE_SQL_EDITOR} target="_blank" rel="noopener noreferrer" className="btn-outline">
          <ExternalLink className="w-4 h-4" aria-hidden="true" />
          Open SQL editor
        </a>
        <button type="button" onClick={recheck} disabled={query.loading} className="btn-outline">
          {query.loading ? <Spinner size="sm" label={null} /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
          Check again
        </button>
      </div>

      <details className="group rounded-xl border border-white/[0.07] bg-[#0b0d17]" open={!compact && !schema.ready}>
        <summary className="flex cursor-pointer select-none items-center gap-2 px-3.5 py-2.5 text-[13px] text-slate-300 hover:text-white">
          <Database className="w-4 h-4 text-slate-500" aria-hidden="true" />
          supabase_migration_v2.sql
          <span className="ml-auto text-xs text-slate-500">{schema.migration_sql.split('\n').length} lines</span>
        </summary>
        <pre className="max-h-80 overflow-auto border-t border-white/[0.06] p-3.5 text-[11px] leading-relaxed text-slate-300 whitespace-pre">
          {schema.migration_sql}
        </pre>
      </details>
    </div>
  )
}
