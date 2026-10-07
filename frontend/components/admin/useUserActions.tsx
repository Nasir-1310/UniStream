'use client'
// components/admin/useUserActions.tsx
//
// Every per-user action (approve, send password, block, delete, …) with its
// confirmation, toast and cache invalidation, shared by the Users list and
// the Overview's pending-requests card so both behave identically.

import {
  Ban,
  CircleCheck,
  Clock3,
  History,
  KeyRound,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { Spinner, useConfirm, useToast } from '@/components/ui'
import {
  adminApproveUser,
  adminBulkUsers,
  adminDeleteUser,
  adminResetUsage,
  adminSendPassword,
  adminSetUserStatus,
  type AdminUser,
  type BulkAction,
  type UserStatus,
} from '@/lib/api'
import { pluralize } from '@/lib/format'
import { useAdmin, userLabel, type CredentialsEntry } from './AdminContext'
import { ActionMenu, type ActionMenuItem } from './ActionMenu'
import { useBusy } from './hooks'

export function useUserActions(options: { onRemoved?: (ids: string[]) => void } = {}) {
  const { onRemoved } = options
  const { reportError, invalidate, presentCredentials, editUser, navigate } = useAdmin()
  const confirm = useConfirm()
  const toast = useToast()
  const { busy, run } = useBusy()

  /** Run an action for one user; errors become toasts. Resolves true on success. */
  const act = async (user: AdminUser, label: string, action: () => Promise<void>, errorTitle: string) => {
    try {
      await run(user.id, label, action)
      return true
    } catch (err) {
      reportError(err, errorTitle)
      return false
    } finally {
      invalidate('users')
    }
  }

  const approve = (user: AdminUser) =>
    act(
      user,
      'Approving…',
      async () => {
        const result = await adminApproveUser(user.id)
        const entries: CredentialsEntry[] = result.credentials ? [{ user: result.user, credentials: result.credentials }] : []
        presentCredentials(entries, `${userLabel(result.user)} approved`)
      },
      'Could not approve this user',
    )

  const sendPassword = async (user: AdminUser) => {
    const ok = await confirm({
      title: user.has_password ? 'Send a new password?' : 'Send a password?',
      message: (
        <>
          A new temporary password is generated for <strong className="text-white">{userLabel(user)}</strong>
          {user.email ? <> and emailed to <span className="text-white break-all">{user.email}</span></> : null}.
          {user.has_password && ' Their current password stops working and they are signed out on every device.'}
          {' '}If the email can’t be sent, you’ll see the password to share yourself.
        </>
      ),
      confirmLabel: user.has_password ? 'Send new password' : 'Send password',
      tone: 'warning',
    })
    if (!ok) return false
    return act(
      user,
      'Sending…',
      async () => {
        const result = await adminSendPassword(user.id)
        presentCredentials(
          result.credentials ? [{ user: result.user, credentials: result.credentials }] : [],
          `New password for ${userLabel(result.user)}`,
        )
      },
      'Could not send a new password',
    )
  }

  const setStatus = async (user: AdminUser, status: UserStatus) => {
    if (status === 'blocked') {
      const ok = await confirm({
        title: `Block ${userLabel(user)}?`,
        message:
          'They are signed out right away and can’t sign in or download until you unblock them. Their account and download history are kept.',
        confirmLabel: 'Block user',
        tone: 'danger',
      })
      if (!ok) return false
    } else if (status === 'pending') {
      const ok = await confirm({
        title: `Move ${userLabel(user)} back to pending?`,
        message: 'They are signed out and see “waiting for approval” until you approve them again.',
        confirmLabel: 'Move to pending',
        tone: 'warning',
      })
      if (!ok) return false
    }
    const done = { approved: 'unblocked', blocked: 'blocked', pending: 'moved to pending' }[status]
    return act(
      user,
      'Updating…',
      async () => {
        const result = await adminSetUserStatus(user.id, status)
        toast.success(`${userLabel(result.user)} ${done}`, {
          description:
            status === 'approved' && !result.user.has_password
              ? 'They have no password yet — use “Send password” so they can sign in.'
              : undefined,
        })
      },
      'Could not change the status',
    )
  }

  const resetUsage = (user: AdminUser) =>
    act(
      user,
      'Resetting…',
      async () => {
        const result = await adminResetUsage(user.id)
        toast.success('Today’s downloads reset', {
          description: `${userLabel(result.user)} can download again today.`,
        })
      },
      'Could not reset today’s downloads',
    )

  const remove = async (user: AdminUser) => {
    const ok = await confirm({
      title: `Delete ${userLabel(user)}?`,
      message:
        'The account is deleted permanently and they can’t sign in again. Their download history is kept for your records. This can’t be undone, so block the user instead if you may want to restore access later.',
      confirmLabel: 'Delete user',
      tone: 'danger',
    })
    if (!ok) return false
    return act(
      user,
      'Deleting…',
      async () => {
        await adminDeleteUser(user.id)
        toast.success(`${userLabel(user)} deleted`)
        onRemoved?.([user.id])
      },
      'Could not delete this user',
    )
  }

  /**
   * Apply one action to several users (the current page's selection).
   * Resolves true when the request went through, even if some users failed.
   */
  const bulk = async (users: AdminUser[], action: BulkAction): Promise<boolean> => {
    if (!users.length) return false
    const count = pluralize(users.length, 'user')
    const prompts: Record<BulkAction, Parameters<typeof confirm>[0]> = {
      approve: {
        title: `Approve ${count}?`,
        message:
          'Each newly approved user gets a temporary password by email (users who already have one keep it). Any password that can’t be emailed is shown to you.',
        confirmLabel: 'Approve',
        tone: 'primary',
      },
      block: {
        title: `Block ${count}?`,
        message: 'They are signed out right away and can’t sign in or download until unblocked.',
        confirmLabel: 'Block',
        tone: 'danger',
      },
      pending: {
        title: `Move ${count} to pending?`,
        message: 'They are signed out and must be approved again.',
        confirmLabel: 'Move to pending',
        tone: 'warning',
      },
      delete: {
        title: `Delete ${count}?`,
        message: 'These accounts are deleted permanently. Their download history is kept. This can’t be undone.',
        confirmLabel: 'Delete',
        tone: 'danger',
        requireText: 'DELETE',
      },
    }
    if (!(await confirm(prompts[action]))) return false

    const byId = new Map(users.map(user => [user.id, user]))
    try {
      const { results } = await run('bulk', 'Working…', () =>
        adminBulkUsers(
          users.map(user => user.id),
          action,
        ),
      )
      const failed = results.filter(result => !result.ok)
      const succeeded = results.length - failed.length
      const verb = { approve: 'approved', block: 'blocked', pending: 'moved to pending', delete: 'deleted' }[action]
      const entries: CredentialsEntry[] = results
        .filter(result => result.ok && result.credentials)
        .map(result => ({ user: byId.get(result.id) ?? { id: result.id, name: null, email: null, phone: null }, credentials: result.credentials! }))

      if (succeeded > 0) presentCredentials(entries, `${pluralize(succeeded, 'user')} ${verb}`)
      if (action === 'delete') onRemoved?.(results.filter(result => result.ok).map(result => result.id))
      if (failed.length) {
        const first = failed[0]
        const who = byId.get(first.id)
        toast.error(`${pluralize(failed.length, 'user')} could not be ${verb}`, {
          description: `${who ? `${userLabel(who)}: ` : ''}${first.error ?? 'Unknown error'}`,
        })
      }
      return true
    } catch (err) {
      reportError(err, 'Couldn’t update the selected users')
      return false
    } finally {
      invalidate('users')
    }
  }

  const viewDownloads = (user: AdminUser) => navigate('logs', { section: 'logs', userId: user.id, userLabel: userLabel(user) })

  /** Menu entries for a user, depending on its status. */
  const menuItems = (user: AdminUser): ActionMenuItem[] => {
    const items: ActionMenuItem[] = [{ key: 'edit', label: 'View & edit', icon: Pencil, onSelect: () => editUser(user) }]
    if (user.status === 'pending') {
      items.push({ key: 'approve', label: 'Approve & send password', icon: CircleCheck, onSelect: () => void approve(user) })
    }
    if (user.status === 'blocked') {
      items.push({ key: 'unblock', label: 'Unblock', icon: ShieldCheck, onSelect: () => void setStatus(user, 'approved') })
      items.push({ key: 'approve', label: 'Approve & send password', icon: CircleCheck, onSelect: () => void approve(user) })
    }
    if (user.status === 'approved') {
      items.push({
        key: 'password',
        label: user.has_password ? 'Send new password' : 'Send password',
        icon: KeyRound,
        onSelect: () => void sendPassword(user),
      })
    }
    if (user.used_today > 0) {
      items.push({ key: 'reset', label: 'Reset today’s downloads', icon: RotateCcw, onSelect: () => void resetUsage(user) })
    }
    if (user.total_downloads > 0) {
      items.push({ key: 'logs', label: 'View download history', icon: History, onSelect: () => viewDownloads(user) })
    }
    if (user.status !== 'pending') {
      items.push({ key: 'pending', label: 'Move to pending', icon: Clock3, onSelect: () => void setStatus(user, 'pending'), separated: true })
    }
    if (user.status !== 'blocked') {
      items.push({
        key: 'block',
        label: 'Block',
        icon: Ban,
        tone: 'danger',
        onSelect: () => void setStatus(user, 'blocked'),
        separated: user.status === 'pending',
      })
    }
    items.push({ key: 'delete', label: 'Delete user', icon: Trash2, tone: 'danger', onSelect: () => void remove(user) })
    return items
  }

  return { busy, approve, sendPassword, setStatus, resetUsage, remove, bulk, viewDownloads, menuItems }
}

export type UserActions = ReturnType<typeof useUserActions>

/** The main action for a user's status, shown as a button next to the ⋮ menu. */
function primaryAction(user: AdminUser, actions: UserActions): { label: string; icon: LucideIcon; run: () => void; tone: string } | null {
  if (user.status === 'pending') {
    return { label: 'Approve', icon: CircleCheck, run: () => void actions.approve(user), tone: 'approve' }
  }
  if (user.status === 'blocked') {
    return { label: 'Unblock', icon: ShieldCheck, run: () => void actions.setStatus(user, 'approved'), tone: 'neutral' }
  }
  if (!user.has_password) {
    return { label: 'Send password', icon: KeyRound, run: () => void actions.sendPassword(user), tone: 'neutral' }
  }
  return null
}

/** Primary action button + ⋮ menu for one user. */
export function UserRowActions({ user, actions, fullWidth = false }: { user: AdminUser; actions: UserActions; fullWidth?: boolean }) {
  const busyLabel = actions.busy[user.id]
  const primary = primaryAction(user, actions)
  const busyBulk = Boolean(actions.busy.bulk)
  return (
    <div className={`flex items-center gap-1.5 ${fullWidth ? 'w-full' : 'justify-end'}`}>
      {busyLabel ? (
        <span className={`inline-flex h-10 items-center gap-2 px-2 text-xs text-slate-400 ${fullWidth ? 'flex-1' : ''}`} role="status">
          <Spinner size="sm" label={null} />
          {busyLabel}
        </span>
      ) : (
        primary && (
          <button
            type="button"
            onClick={primary.run}
            disabled={busyBulk}
            className={`btn-sm inline-flex items-center justify-center gap-1.5 rounded-lg border font-semibold whitespace-nowrap transition-colors
              disabled:opacity-40 ${fullWidth ? 'flex-1' : ''} ${
                primary.tone === 'approve'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                  : 'border-white/10 text-slate-200 hover:bg-white/[0.06]'
              }`}
          >
            <primary.icon className="w-4 h-4" aria-hidden="true" />
            {primary.label}
          </button>
        )
      )}
      <ActionMenu
        label={`More actions for ${userLabel(user)}`}
        items={actions.menuItems(user)}
        disabled={Boolean(busyLabel) || busyBulk}
      />
    </div>
  )
}
