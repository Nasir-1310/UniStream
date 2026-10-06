// components/ui/index.ts — shared UI primitives.
// Client components carry their own 'use client'; import from here or from the
// individual files.

export { Alert, type AlertProps, type AlertTone } from './Alert'
export { Badge, StatusBadge, PlatformBadge, PlatformIcon, platformStyle, type BadgeProps, type BadgeTone } from './Badge'
export {
  ConfirmDialog,
  ConfirmProvider,
  useConfirm,
  type ConfirmDialogProps,
  type ConfirmOptions,
  type ConfirmTone,
} from './ConfirmDialog'
export { EmptyState, type EmptyStateProps } from './EmptyState'
export { Field, describedBy, type FieldProps } from './Field'
export { Modal, type ModalProps } from './Modal'
export { Pagination, type PaginationProps } from './Pagination'
export { PasswordInput, type PasswordInputProps } from './PasswordInput'
export { Spinner, PageLoader, type SpinnerProps, type PageLoaderProps } from './Spinner'
export { ToastProvider, useToast, type ToastApi, type ToastOptions, type ToastTone } from './Toast'
