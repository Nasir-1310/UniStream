'use client'
// components/admin/AdminSetup.tsx
//
// "Set your admin username and password": shown instead of the dashboard
// while the admin is signed in with the setup password from the server
// (ADMIN_SECRET / ADMIN_PASSWORD), i.e. on the first sign-in or in recovery
// mode. The new password is stored in the database, so when the database
// upgrade hasn't been run yet this screen also offers it as step 1 — the
// owner must never be stuck without a way to reach the upgrade SQL.

import { useEffect, useRef } from 'react'
import { Database, KeyRound, LogOut } from 'lucide-react'
import Navbar from '@/components/Navbar'
import { Alert, useToast } from '@/components/ui'
import { adminGetSchema, type AdminSession } from '@/lib/api'
import { AdminCredentialsForm } from './AdminCredentialsForm'
import { useAdminQuery } from './hooks'
import { MigrationPanel } from './MigrationPanel'
import { Card } from './parts'

export function AdminSetup({
  session,
  recoveryMode,
  initialCurrentPassword,
  onDone,
  onSignOut,
}: {
  session: AdminSession
  recoveryMode: boolean
  initialCurrentPassword: string
  onDone: () => void
  onSignOut: () => void
}) {
  const toast = useToast()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const schema = useAdminQuery('setup-schema', adminGetSchema)

  // This screen replaces the sign-in form: start keyboard and screen-reader
  // users at its heading rather than at the top of the document.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])
  const upgradeNeeded = schema.data ? !schema.data.ready : false

  return (
    <div className="min-h-svh flex flex-col bg-[#0d0f1a]">
      <Navbar
        showAuth={false}
        homeHref="/"
        rightSlot={
          <button type="button" onClick={onSignOut} className="btn-outline" aria-label="Sign out">
            <LogOut className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        }
      />
      <main id="main" className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-4 sm:space-y-5">
        <header className="flex items-start gap-3.5">
          <span className="w-11 h-11 flex-shrink-0 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-900/50">
            <KeyRound className="w-5 h-5 text-white" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 ref={headingRef} tabIndex={-1} className="text-xl sm:text-2xl font-bold text-white outline-none">
              Set your admin username and password
            </h1>
            <p className="mt-1 text-[13px] sm:text-sm text-slate-400">
              You signed in with the setup password from the server. Choose your own sign-in details to open the dashboard.
            </p>
          </div>
        </header>

        {recoveryMode && (
          <Alert tone="warning" title="Password recovery is on">
            Choose a new password below. Then remove <code className="text-slate-100">ADMIN_RESET_PASSWORD</code> from your
            server settings and redeploy, so the setup password stops working.
          </Alert>
        )}

        {upgradeNeeded && (
          <Card
            title="Step 1: Upgrade the database"
            description="A one-time step. Your new password is saved in the database, so do this first."
            icon={Database}
          >
            <MigrationPanel query={schema} />
          </Card>
        )}

        <Card
          title={upgradeNeeded ? 'Step 2: Choose your sign-in details' : 'Choose your sign-in details'}
          description="Use these from now on instead of the setup password."
          icon={KeyRound}
        >
          <AdminCredentialsForm
            mode="setup"
            session={session}
            initialCurrentPassword={initialCurrentPassword}
            onSchemaRequired={schema.reload}
            onSaved={auth => {
              onDone()
              toast.success('Admin account saved', {
                description: `Sign in as ${auth.username} with your new password from now on.`,
              })
            }}
          />
        </Card>

        {schema.error && !schema.data && (
          <Alert tone="warning" title="Couldn’t check the database">
            {schema.error}{' '}
            <button type="button" onClick={schema.reload} className="font-medium text-amber-200 underline underline-offset-2 hover:text-white">
              Try again
            </button>
          </Alert>
        )}
      </main>
      {/* No site footer here: it is the Bangla public site's; the admin panel is English. */}
    </div>
  )
}
