'use client'
// components/admin/MigrationPanel.tsx
//
// The v2 database script with copy + "open Supabase SQL editor". Shown when
// the Supabase schema is missing the v2 columns, and on the System page for
// reference. "Check again" re-probes the database after the admin ran it.

import { Database, ExternalLink, RefreshCw } from 'lucide-react'
import { Alert, Spinner } from '@/components/ui'
import { adminGetSchema } from '@/lib/api'
import { useAdmin } from './AdminContext'
import { useAdminQuery } from './hooks'
import { CopyButton, QueryError, SkeletonRows } from './parts'

// "_" lets Supabase ask which project to open, so no project id is needed here.
const SUPABASE_SQL_EDITOR = 'https://supabase.com/dashboard/project/_/sql/new'

export function MigrationPanel({ compact = false }: { compact?: boolean }) {
  const { invalidate } = useAdmin()
  const query = useAdminQuery('schema', adminGetSchema)
  const schema = query.data

  const recheck = () => {
    query.reload()
    // The overview's "upgrade required" banner and the system page read the same status.
    invalidate('system')
  }

  if (!schema) {
    return query.error ? <QueryError message={query.error} onRetry={query.reload} /> : <SkeletonRows count={2} className="h-12" />
  }

  return (
    <div className="space-y-3">
      {schema.ready ? (
        <Alert tone="success" title="Database is up to date" live="off">
          All v2 tables, columns and functions are in place.
        </Alert>
      ) : (
        <div className="text-[13px] text-slate-300 space-y-2">
          <ol className="list-decimal pl-5 space-y-1 text-slate-300">
            <li>Copy the script below.</li>
            <li>
              Open the{' '}
              <a href={SUPABASE_SQL_EDITOR} target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline underline-offset-2 hover:text-indigo-200">
                Supabase SQL editor
              </a>{' '}
              for your project, paste it and press <span className="font-semibold text-white">Run</span>. It is safe to run more than once.
            </li>
            <li>Come back and press “Check again”.</li>
          </ol>
          {schema.missing.length > 0 && (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer select-none py-1 hover:text-slate-300">
                {schema.missing.length} missing item{schema.missing.length === 1 ? '' : 's'}
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
