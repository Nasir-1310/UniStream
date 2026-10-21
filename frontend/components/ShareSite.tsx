'use client'
// components/ShareSite.tsx
//
// "বন্ধুকে জানান": share the site's link with friends in one tap. The dialog
// offers WhatsApp, Messenger (phones), Facebook and Copy link, plus the
// phone's own share sheet where there is one. Used in the footer of every
// page and, after a finished download, as a small prompt on the download page.

import { useState, useSyncExternalStore } from 'react'
import { Copy, Facebook, MessageCircle, Share2, X } from 'lucide-react'
import { Modal, useToast } from '@/components/ui'
import { WhatsAppIcon } from '@/components/ContactCard'

const noopSubscribe = () => () => {}
const readOrigin = () => window.location.origin
const serverOrigin = () => ''

const SHARE_TEXT =
  'পছন্দের ভিডিও, Reels, গান বা লেকচার: YouTube, Facebook ও Instagram থেকে 4K পর্যন্ত সেভ করি UniStream ' +
  'Downloader দিয়ে, শিক্ষার্থীদের জন্য ফ্রি। তুমিও দেখো 👇'

function isPhone(): boolean {
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function ShareDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const origin = useSyncExternalStore(noopSubscribe, readOrigin, serverOrigin)
  if (!open || !origin) return null

  const url = `${origin}/`
  const message = `${SHARE_TEXT}\n${url}`
  const phone = isPhone()
  const canNativeShare = typeof navigator.share === 'function'

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(message)
      toast.success('লিংক কপি হয়েছে', { description: 'যেকোনো চ্যাট বা গ্রুপে পেস্ট করে দিন।' })
    } catch {
      toast.info('এই লিংকটি কপি করুন', { description: url })
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: 'UniStream Downloader', text: SHARE_TEXT, url })
      onClose()
    } catch {
      // Closed the share sheet: nothing to do.
    }
  }

  const option = 'flex items-center gap-3 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 h-14 text-[15px] font-semibold text-white hover:bg-white/[0.06] transition-colors'

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      icon={
        <span className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
          <Share2 className="w-5 h-5 text-indigo-300" aria-hidden="true" />
        </span>
      }
      title="বন্ধুদের জানান"
      description="যাদের কাজে লাগবে তাদের সাথে লিংকটা শেয়ার করুন।"
      footer={
        <button type="button" onClick={onClose} className="btn-secondary">
          বন্ধ করুন
        </button>
      }
    >
      <div className="grid gap-2.5">
        <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" className={option}>
          <WhatsAppIcon className="w-6 h-6 text-[#1fa855]" />
          WhatsApp
        </a>
        {phone && (
          <a href={`fb-messenger://share/?link=${encodeURIComponent(url)}`} className={option}>
            <MessageCircle className="w-6 h-6 text-[#0084ff]" aria-hidden="true" />
            Messenger
          </a>
        )}
        <a
          href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={option}
        >
          <Facebook className="w-6 h-6 text-[#1877f2]" aria-hidden="true" />
          Facebook-এ পোস্ট করুন
        </a>
        <button type="button" onClick={() => void copyLink()} className={option}>
          <Copy className="w-6 h-6 text-slate-400" aria-hidden="true" />
          লিংক কপি করুন
        </button>
        {canNativeShare && (
          <button type="button" onClick={() => void nativeShare()} className={option}>
            <Share2 className="w-6 h-6 text-slate-400" aria-hidden="true" />
            অন্য অ্যাপে শেয়ার
          </button>
        )}
      </div>
    </Modal>
  )
}

/** "বন্ধুকে জানান" as a footer list item. */
export function ShareListItem({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={className}>
        বন্ধুকে জানান
      </button>
      <ShareDialog open={open} onClose={() => setOpen(false)} />
    </li>
  )
}

// ── After a download ──────────────────────────────────────────────────────────

const PROMPT_KEY = 'us_share_prompt_hidden_at'
const PROMPT_HIDE_MS = 14 * 24 * 60 * 60 * 1000

function promptHiddenRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(PROMPT_KEY))
    return Number.isFinite(at) && at > 0 && Date.now() - at < PROMPT_HIDE_MS
  } catch {
    return false
  }
}

/**
 * Shown once a download has finished: a friendly nudge to share. × (or
 * sharing) hides it for two weeks, so it never nags.
 */
export function SharePrompt({ show }: { show: boolean }) {
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(() => typeof window !== 'undefined' && promptHiddenRecently())
  if (!show || hidden) return null

  function hide() {
    setHidden(true)
    try {
      window.localStorage.setItem(PROMPT_KEY, String(Date.now()))
    } catch {
      // Private mode: it may come back next visit.
    }
  }

  return (
    <div className="surface-card flex items-center gap-3 px-3.5 py-3 sm:px-4 fade-up">
      <span className="w-10 h-10 flex-shrink-0 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-xl" aria-hidden="true">
        🙌
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-white leading-snug">কাজে লেগেছে? বন্ধুদের জানান</p>
        <p className="text-[12.5px] leading-snug text-slate-400">এক ট্যাপে WhatsApp, Messenger বা Facebook-এ শেয়ার করুন।</p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="btn-primary btn-sm flex-shrink-0"
      >
        <Share2 className="w-4 h-4" aria-hidden="true" />
        শেয়ার
      </button>
      <button
        type="button"
        onClick={hide}
        aria-label="শেয়ারের প্রস্তাব লুকান"
        className="-mr-1.5 w-9 h-9 flex-shrink-0 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-colors"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
      <ShareDialog
        open={open}
        onClose={() => {
          setOpen(false)
          hide()
        }}
      />
    </div>
  )
}
