'use client'
// components/FeedbackDialog.tsx
//
// "Report a problem / Send feedback": signed-in users tell the admin about a
// download that went wrong (opened from a failed download, with its link,
// quality and error already filled in), or share feedback and ideas. The
// admin reads them under Admin → Feedback.

import { useState, type FormEvent } from 'react'
import { Bug, Lightbulb, MessageSquareHeart, Send } from 'lucide-react'
import { Alert, Field, Modal, Spinner, describedBy, useToast } from '@/components/ui'
import { apiErrorMessage, sendFeedback, type FeedbackKind } from '@/lib/api'

export interface FeedbackPrefill {
  kind?: FeedbackKind
  /** The video link the problem happened with. */
  url?: string
  /** Shown to the user and sent along: quality, platform, error text. */
  details?: string
}

export interface FeedbackDialogProps {
  open: boolean
  onClose: () => void
  prefill?: FeedbackPrefill | null
}

const KINDS: { id: FeedbackKind; label: string; hint: string; Icon: typeof Bug }[] = [
  { id: 'problem', label: 'সমস্যা জানান', hint: 'ডাউনলোড ব্যর্থ হয়েছে বা কিছু কাজ করেনি।', Icon: Bug },
  { id: 'feedback', label: 'মতামত', hint: 'কী ভালো লেগেছে বা কী আরও ভালো হতে পারে।', Icon: MessageSquareHeart },
  { id: 'idea', label: 'আইডিয়া দিন', hint: 'যে ফিচার বা সাইট আমরা যোগ করতে পারি।', Icon: Lightbulb },
]

const PLACEHOLDERS: Record<FeedbackKind, string> = {
  problem: 'কী হয়েছিল? যেমন: “4K ডাউনলোড 99%-এ এসে merging-এর সময় থেমে গেছে।”',
  feedback: 'কী ভালো লেগেছে, আর কী আরও ভালো হতে পারে?',
  idea: 'UniStream Saver-এ আর কী চান?',
}

const MAX_MESSAGE = 2000

/**
 * Starts from `prefill` (e.g. the failed download). Give it a `key` that
 * changes with each opening so every report starts from a clean form.
 */
export function FeedbackDialog({ open, onClose, prefill }: FeedbackDialogProps) {
  const toast = useToast()
  const [kind, setKind] = useState<FeedbackKind>(prefill?.kind ?? 'feedback')
  const [message, setMessage] = useState('')
  const [url, setUrl] = useState(prefill?.url ?? '')
  const [messageError, setMessageError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const details = prefill?.details?.trim() || ''

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const text = message.trim()
    if (text.length < 3) {
      setMessageError('বিষয়টি নিয়ে কয়েকটা কথা লিখুন।')
      return
    }
    setMessageError(null)
    setError(null)
    setSending(true)
    try {
      await sendFeedback({ kind, message: text, url: url.trim() || null, details: details || null })
      toast.success(kind === 'problem' ? 'সমস্যাটি জানানো হয়েছে' : 'মতামতের জন্য ধন্যবাদ', {
        description: 'আপনার বার্তা UniStream টিমের কাছে পৌঁছেছে। আমরা প্রতিটি বার্তা পড়ি।',
      })
      onClose()
    } catch (err) {
      setError(apiErrorMessage(err, 'বার্তা পাঠানো যায়নি। আবার চেষ্টা করুন।'))
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!sending}
      size="lg"
      icon={
        <span className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center">
          <MessageSquareHeart className="w-5 h-5 text-indigo-300" aria-hidden="true" />
        </span>
      }
      title="সমস্যা জানান বা মতামত দিন"
      description="কী সমস্যা হয়েছে বা কীভাবে আরও ভালো করা যায় জানান। পরের সংস্করণে সমস্যা ঠিক করতে আমরা এগুলো কাজে লাগাই।"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={sending} className="btn-secondary">
            বাতিল
          </button>
          <button type="submit" form="feedback-form" disabled={sending} className="btn-primary">
            {sending ? <Spinner size="sm" label={null} /> : <Send className="w-4 h-4" aria-hidden="true" />}
            {sending ? 'পাঠানো হচ্ছে…' : 'পাঠান'}
          </button>
        </>
      }
    >
      <form id="feedback-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <fieldset>
          <legend className="text-[13px] font-medium text-slate-300 mb-1.5">কোন বিষয়ে?</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {KINDS.map(({ id, label, hint, Icon }) => {
              const checked = kind === id
              return (
                <label
                  key={id}
                  className={`flex cursor-pointer flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    checked
                      ? 'border-indigo-400/60 bg-indigo-500/10'
                      : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20'
                  }`}
                >
                  <input
                    type="radio"
                    name="feedback-kind"
                    value={id}
                    checked={checked}
                    onChange={() => setKind(id)}
                    className="sr-only"
                  />
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white">
                    <Icon className={`w-4 h-4 ${checked ? 'text-indigo-300' : 'text-slate-400'}`} aria-hidden="true" />
                    {label}
                  </span>
                  <span className="text-[11px] leading-snug text-slate-400">{hint}</span>
                </label>
              )
            })}
          </div>
        </fieldset>

        <Field
          htmlFor="feedback-message"
          label="আপনার বার্তা"
          error={messageError}
          hint={`${message.length}/${MAX_MESSAGE}`}
        >
          <textarea
            id="feedback-message"
            value={message}
            onChange={e => {
              setMessage(e.target.value.slice(0, MAX_MESSAGE))
              if (messageError) setMessageError(null)
            }}
            rows={5}
            placeholder={PLACEHOLDERS[kind]}
            aria-invalid={messageError ? true : undefined}
            aria-describedby={describedBy('feedback-message', messageError, true)}
            data-autofocus
            className="input-field min-h-[120px] resize-y py-2.5"
          />
        </Field>

        <Field htmlFor="feedback-url" label="ভিডিওর লিংক" optional hint="ডাউনলোডের সমস্যাটি খুঁজে বের করতে সাহায্য করে।">
          <input
            id="feedback-url"
            type="url"
            inputMode="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://…"
            aria-describedby={describedBy('feedback-url', null, true)}
            className="input-field py-2.5"
          />
        </Field>

        {details && (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5">
            <p className="text-[12px] font-medium text-slate-300">স্বয়ংক্রিয়ভাবে যা পাঠানো হবে</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400 break-words">{details}</p>
          </div>
        )}

        {error && (
          <Alert tone="danger" title="পাঠানো যায়নি">
            {error}
          </Alert>
        )}
      </form>
    </Modal>
  )
}

export default FeedbackDialog
