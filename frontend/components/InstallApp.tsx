'use client'
// components/InstallApp.tsx
//
// Installing the site as an app (PWA), kept to as few taps as possible:
// "অ্যাপ ইনস্টল করুন" → a dialog with the visitor's device already chosen →
// "ইনস্টল করুন" → the browser's own confirmation. Chrome, Edge and Samsung
// Internet need nothing else. iPhone has no install button for websites, so
// its tab shows the three Safari taps with the icons to look for; Facebook's
// built-in browser and the like get a one-tap "open in Chrome" first.
// Nothing renders inside the installed app.

import { useEffect, useState, type ReactNode } from 'react'
import {
  CheckCircle2,
  Chrome,
  Copy,
  Laptop,
  MonitorDown,
  RefreshCw,
  Share,
  Smartphone,
  SquarePlus,
  X,
} from 'lucide-react'
import { Alert, Modal, Spinner, useToast } from '@/components/ui'
import { BrandMark } from '@/components/Brand'
import {
  chromeIntentUrl,
  promptInstall,
  useInstallState,
  type InstallPlatform,
  type InstallState,
} from '@/lib/pwa'

// ── Entry points ──────────────────────────────────────────────────────────────

export interface InstallButtonProps {
  className?: string
  label?: string
  /** Hide the icon (e.g. in a text link). */
  plain?: boolean
}

/** Opens the install dialog. Renders nothing in the installed app and before hydration. */
export function InstallButton({ className = 'btn-primary', label = 'অ্যাপ ইনস্টল করুন', plain = false }: InstallButtonProps) {
  const install = useInstallState()
  const [open, setOpen] = useState(false)
  if (!install.ready) return null
  const Icon = install.platform === 'desktop' ? MonitorDown : Smartphone
  return (
    <>
      {!install.installed && (
        <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={className}>
          {!plain && <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />}
          {label}
        </button>
      )}
      {/* Kept mounted after installing, to show the "done" step. */}
      <InstallDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}

/** "অ্যাপ ইনস্টল করুন" as a footer list item; no empty <li> inside the app. */
export function InstallListItem({ className }: { className?: string }) {
  const install = useInstallState()
  if (!install.ready || install.installed) return null
  return (
    <li>
      <InstallButton className={className} plain />
    </li>
  )
}

// ── The dialog ────────────────────────────────────────────────────────────────

const DEVICES: { id: InstallPlatform; label: string; Icon: typeof Smartphone }[] = [
  { id: 'android', label: 'Android', Icon: Smartphone },
  { id: 'ios', label: 'iPhone', Icon: Smartphone },
  { id: 'desktop', label: 'কম্পিউটার', Icon: Laptop },
]

/** Seconds to wait for Chrome's install event before also showing the menu route. */
const SLOW_AFTER_MS = 8000

export function InstallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const install = useInstallState()
  const toast = useToast()
  const [device, setDevice] = useState<InstallPlatform | null>(null)
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)
  const selected = device ?? install.platform
  const view = dialogView(install, selected)

  // Chrome offers the install only after ~30 s on the site: say so if it takes long.
  useEffect(() => {
    if (!open || view !== 'waiting') return
    const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [open, view])

  // Closed (or still on the server): nothing to build, e.g. the Chrome link needs `window`.
  if (!open || !install.ready) return null

  async function installNow() {
    setBusy(true)
    const outcome = await promptInstall()
    setBusy(false)
    if (outcome === 'accepted') {
      toast.success('অ্যাপ ইনস্টল হচ্ছে', { description: 'কয়েক সেকেন্ডের মধ্যে হোম স্ক্রিনে UniStream আইকন আসবে।' })
    }
  }

  async function copyLink() {
    const url = `${window.location.origin}/`
    try {
      await navigator.clipboard.writeText(url)
      toast.success('লিংক কপি হয়েছে', { description: url })
    } catch {
      toast.info('এই লিংকটি কপি করুন', { description: url })
    }
  }

  const close = (
    <button type="button" onClick={onClose} className="btn-secondary">
      এখন না
    </button>
  )
  let footer: ReactNode
  switch (view) {
    case 'ready':
      footer = (
        <>
          {close}
          <button type="button" onClick={() => void installNow()} disabled={busy} className="btn-primary" data-autofocus>
            {busy ? <Spinner size="sm" label={null} /> : <MonitorDown className="w-4 h-4" aria-hidden="true" />}
            ইনস্টল করুন
          </button>
        </>
      )
      break
    case 'waiting':
      footer = (
        <>
          {close}
          <button type="button" disabled className="btn-primary">
            <Spinner size="sm" label={null} />
            প্রস্তুত হচ্ছে…
          </button>
        </>
      )
      break
    case 'dismissed':
      footer = (
        <>
          {close}
          <button type="button" onClick={() => window.location.reload()} className="btn-primary" data-autofocus>
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            আবার চেষ্টা করুন
          </button>
        </>
      )
      break
    case 'open-in-chrome':
      footer = (
        <>
          {close}
          <a href={chromeIntentUrl()} className="btn-primary" data-autofocus>
            <Chrome className="w-4 h-4" aria-hidden="true" />
            Chrome-এ খুলুন
          </a>
        </>
      )
      break
    default:
      footer = (
        <button type="button" onClick={onClose} className="btn-primary" data-autofocus>
          ঠিক আছে
        </button>
      )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      icon={<BrandMark className="w-11 h-11" />}
      title="UniStream অ্যাপ ইনস্টল করুন"
      description="Play Store লাগবে না। ইনস্টল হলে হোম স্ক্রিনে UniStream আইকন আসবে।"
      footer={footer}
    >
      {view !== 'done' && view !== 'already' && (
        <div role="group" aria-label="আপনার ডিভাইস" className="grid grid-cols-3 gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
          {DEVICES.map(({ id, label, Icon }) => {
            const active = id === selected
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => setDevice(id)}
                className={`inline-flex items-center justify-center gap-1.5 h-10 rounded-lg text-[13px] font-semibold transition-colors ${
                  active ? 'bg-indigo-600 text-[#fff] shadow-sm' : 'text-slate-300 hover:bg-white/[0.06]'
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                {label}
              </button>
            )
          })}
        </div>
      )}

      <div className="mt-4" aria-live="polite">
        <DialogBody view={view} install={install} selected={selected} slow={slow} onCopyLink={() => void copyLink()} />
      </div>
    </Modal>
  )
}

type View =
  | 'ready' // one tap: the browser's install dialog
  | 'waiting' // Chrome hasn't offered the install yet
  | 'dismissed' // the visitor cancelled the browser's dialog
  | 'done' // installed this visit
  | 'already' // installed earlier on this device
  | 'ios' // Safari steps (or "open Safari first")
  | 'open-in-chrome' // Android outside Chrome: hop to Chrome first
  | 'desktop-manual' // Safari on Mac, Firefox...
  | 'other-device' // e.g. the iPhone tab on a computer

function dialogView(install: InstallState, selected: InstallPlatform): View {
  if (install.justInstalled) return 'done'
  if (selected !== install.platform) return 'other-device'
  if (install.alreadyInstalled) return 'already'
  if (selected === 'ios') return 'ios'
  if (install.canPrompt && !install.inAppBrowser) return 'ready'
  if (selected === 'android' && (install.inAppBrowser || !install.supportsPrompt)) return 'open-in-chrome'
  if (install.dismissed) return 'dismissed'
  if (install.supportsPrompt && !install.inAppBrowser) return 'waiting'
  return 'desktop-manual'
}

function DialogBody({
  view,
  install,
  selected,
  slow,
  onCopyLink,
}: {
  view: View
  install: InstallState
  selected: InstallPlatform
  slow: boolean
  onCopyLink: () => void
}) {
  switch (view) {
    case 'ready':
      return (
        <>
          <AppCard />
          <p className="mt-4 text-[14px] leading-relaxed text-slate-300">
            নিচের <strong className="text-white">ইনস্টল করুন</strong> চাপুন। ব্রাউজার জিজ্ঞেস করলে আরেকবার{' '}
            <strong className="text-white">Install</strong> চাপলেই হয়ে যাবে।
          </p>
        </>
      )

    case 'waiting':
      return (
        <>
          <AppCard />
          <p className="mt-4 text-[14px] leading-relaxed text-slate-300">
            এক মুহূর্ত, ইনস্টল প্রস্তুত হচ্ছে। প্রস্তুত হলেই নিচের বাটন চালু হবে।
          </p>
          {slow && (
            <p className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3 text-[13px] leading-relaxed text-slate-400">
              বেশি সময় লাগছে? ব্রাউজারের <Key label="তিন-ডট মেনু">⋮</Key> মেনু থেকে{' '}
              <strong className="text-slate-200">“Install app”</strong> বা{' '}
              <strong className="text-slate-200">“Add to Home screen”</strong> চাপুন।
            </p>
          )}
        </>
      )

    case 'dismissed':
      return (
        <p className="text-[14px] leading-relaxed text-slate-300">
          ইনস্টল বাতিল করা হয়েছে। আবার চাইলে <strong className="text-white">আবার চেষ্টা করুন</strong> চাপুন, তারপর{' '}
          <strong className="text-white">ইনস্টল করুন</strong>।
        </p>
      )

    case 'done':
      return (
        <Success title="ইনস্টল হয়ে গেছে!">
          ফোনের হোম স্ক্রিনে (কম্পিউটারে ডেস্কটপ বা স্টার্ট মেনুতে) <strong className="text-white">UniStream</strong> আইকন
          দেখুন। এরপর থেকে সেখান থেকেই এক ট্যাপে খুলুন।
        </Success>
      )

    case 'already':
      return (
        <Success title="অ্যাপটি আগেই ইনস্টল করা আছে">
          হোম স্ক্রিন বা অ্যাপের তালিকায় <strong className="text-white">UniStream</strong> আইকন চাপলেই খুলবে।
        </Success>
      )

    case 'ios':
      return <IosSteps install={install} onCopyLink={onCopyLink} />

    case 'open-in-chrome':
      return (
        <>
          <p className="text-[14px] leading-relaxed text-slate-300">
            {install.inAppBrowser
              ? 'Facebook, Messenger বা Instagram-এর ভেতর থেকে অ্যাপ ইনস্টল হয় না।'
              : 'এই ব্রাউজার থেকে সরাসরি ইনস্টল হয় না।'}{' '}
            নিচের <strong className="text-white">Chrome-এ খুলুন</strong> চাপুন, তারপর Chrome-এ আবার{' '}
            <strong className="text-white">অ্যাপ ইনস্টল করুন</strong> চাপুন।
          </p>
          {!install.inAppBrowser && (
            <p className="mt-3 text-[13px] leading-relaxed text-slate-400">
              অথবা এই ব্রাউজারের <Key label="তিন-ডট মেনু">⋮</Key> মেনু থেকে “Install” বা “Add to Home screen” বেছে নিন।
            </p>
          )}
        </>
      )

    case 'desktop-manual':
      return install.browser === 'safari' ? (
        <p className="text-[14px] leading-relaxed text-slate-300">
          Mac-এর Safari-তে: ওপরের মেনু বার থেকে <strong className="text-white">File</strong> →{' '}
          <strong className="text-white">Add to Dock</strong> বেছে নিন, তারপর <strong className="text-white">Add</strong>।
        </p>
      ) : (
        <>
          <p className="text-[14px] leading-relaxed text-slate-300">
            এই ব্রাউজারে অ্যাপ ইনস্টল হয় না। <strong className="text-white">Chrome</strong> বা{' '}
            <strong className="text-white">Edge</strong>-এ সাইটটি খুলে আবার “অ্যাপ ইনস্টল করুন” চাপুন।
          </p>
          <CopyLinkButton onClick={onCopyLink} />
        </>
      )

    case 'other-device':
      return (
        <>
          <p className="text-[14px] leading-relaxed text-slate-300">{OTHER_DEVICE_TEXT[selected]}</p>
          <CopyLinkButton onClick={onCopyLink} label="লিংক কপি করে ওই ডিভাইসে পাঠান" />
        </>
      )
  }
}

const OTHER_DEVICE_TEXT: Record<InstallPlatform, ReactNode> = {
  android: (
    <>
      Android ফোনে <strong className="text-white">Chrome</strong> দিয়ে এই সাইট খুলুন, তারপর{' '}
      <strong className="text-white">অ্যাপ ইনস্টল করুন</strong> → <strong className="text-white">ইনস্টল করুন</strong> চাপুন।
    </>
  ),
  ios: (
    <>
      iPhone-এ <strong className="text-white">Safari</strong> দিয়ে এই সাইট খুলুন, তারপর{' '}
      <strong className="text-white">অ্যাপ ইনস্টল করুন</strong> চাপলেই ধাপগুলো দেখাবে।
    </>
  ),
  desktop: (
    <>
      কম্পিউটারে <strong className="text-white">Chrome</strong> বা <strong className="text-white">Edge</strong> দিয়ে এই
      সাইট খুলুন, তারপর <strong className="text-white">অ্যাপ ইনস্টল করুন</strong> →{' '}
      <strong className="text-white">ইনস্টল করুন</strong> চাপুন।
    </>
  ),
}

/** iPhone: websites can't install themselves, so show the three Safari taps. */
function IosSteps({ install, onCopyLink }: { install: InstallState; onCopyLink: () => void }) {
  if (install.inAppBrowser) {
    return (
      <>
        <Alert tone="info" title="আগে Safari-তে খুলুন">
          Facebook, Messenger বা Instagram-এর ভেতর থেকে ইনস্টল হয় না। ওপরে বা নিচের <Key label="আরও">···</Key> মেনু থেকে
          “Open in Safari” / “Open in browser” চাপুন, তারপর আবার “অ্যাপ ইনস্টল করুন” চাপুন।
        </Alert>
        <CopyLinkButton onClick={onCopyLink} />
      </>
    )
  }
  const safari = install.browser === 'safari'
  const steps: { icon?: ReactNode; text: ReactNode; hint?: string }[] = [
    {
      icon: <Share className="w-5 h-5" />,
      text: safari ? (
        <>
          নিচের <strong className="text-white">Share</strong> বাটন চাপুন
        </>
      ) : (
        <>
          ওপরের <strong className="text-white">Share</strong> বাটন চাপুন
        </>
      ),
      hint: safari ? 'Share না দেখলে আগে ··· বাটন চাপুন' : undefined,
    },
    {
      icon: <SquarePlus className="w-5 h-5" />,
      text: (
        <>
          <strong className="text-white">Add to Home Screen</strong> চাপুন
        </>
      ),
      hint: 'দেখতে না পেলে তালিকাটি একটু ওপরে টানুন',
    },
    {
      text: (
        <>
          ওপরে ডানে <strong className="text-white">Add</strong> চাপুন — ব্যস!
        </>
      ),
    },
  ]
  return (
    <ol className="space-y-2.5">
      {steps.map((step, index) => (
        <li key={index} className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3">
          <span
            className="w-7 h-7 flex-shrink-0 rounded-full bg-indigo-600 text-[#fff] text-[13px] font-bold flex items-center justify-center"
            aria-hidden="true"
          >
            {index + 1}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[14px] leading-snug text-slate-300">{step.text}</span>
            {step.hint && <span className="block mt-0.5 text-[12px] text-slate-500">{step.hint}</span>}
          </span>
          {step.icon && (
            <span
              className="w-10 h-10 flex-shrink-0 rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 flex items-center justify-center"
              aria-hidden="true"
            >
              {step.icon}
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

function AppCard() {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5">
      <BrandMark className="w-14 h-14 flex-shrink-0 drop-shadow-sm" />
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-white">UniStream Downloader</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-slate-400">ফ্রি · বিজ্ঞাপন নেই · ফোনের জায়গা প্রায় লাগে না</p>
      </div>
    </div>
  )
}

function Success({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
      <CheckCircle2 className="w-6 h-6 flex-shrink-0 text-emerald-400" aria-hidden="true" />
      <div>
        <p className="text-[15px] font-semibold text-white">{title}</p>
        <p className="mt-1 text-[13.5px] leading-relaxed text-slate-300">{children}</p>
      </div>
    </div>
  )
}

function CopyLinkButton({ onClick, label = 'সাইটের লিংক কপি করুন' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="btn-outline btn-sm mt-3">
      <Copy className="w-4 h-4" aria-hidden="true" />
      {label}
    </button>
  )
}

/** A key-cap with the browser button's symbol; the label is for screen readers. */
function Key({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center align-middle mx-0.5 min-w-6 h-6 px-1 rounded-md border border-white/15 bg-white/[0.06] text-slate-200 font-bold leading-none">
      <span aria-hidden="true">{children}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

// ── Download page banner ──────────────────────────────────────────────────────

const BANNER_KEY = 'us_install_banner_hidden_at'
const BANNER_HIDE_MS = 30 * 24 * 60 * 60 * 1000

function bannerHiddenRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(BANNER_KEY))
    return Number.isFinite(at) && at > 0 && Date.now() - at < BANNER_HIDE_MS
  } catch {
    return false
  }
}

/** "Get the app" strip on the download page; × hides it for 30 days. */
export function InstallBanner() {
  const install = useInstallState()
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(() => typeof window !== 'undefined' && bannerHiddenRecently())
  if (!install.ready || hidden || (install.installed && !open)) return null

  function hide() {
    setHidden(true)
    try {
      window.localStorage.setItem(BANNER_KEY, String(Date.now()))
    } catch {
      // Private mode: it just comes back next visit.
    }
  }

  return (
    <div className="surface-card flex items-center gap-3 px-3.5 py-3 sm:px-4">
      <BrandMark className="w-10 h-10 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-white leading-snug">UniStream অ্যাপ নিন</p>
        <p className="text-[12.5px] leading-snug text-slate-400">হোম স্ক্রিন থেকে এক ট্যাপে খুলুন, Play Store লাগবে না।</p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="btn-primary btn-sm flex-shrink-0"
      >
        ইনস্টল
      </button>
      <button
        type="button"
        onClick={hide}
        aria-label="অ্যাপ ইনস্টলের প্রস্তাব লুকান"
        className="-mr-1.5 w-9 h-9 flex-shrink-0 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-colors"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
      <InstallDialog open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

// ── Landing page section ──────────────────────────────────────────────────────

const APP_POINTS = [
  'এক ট্যাপে ইনস্টল — Play Store লাগবে না',
  'Android, iPhone আর কম্পিউটার — সবখানে চলে',
  'ফোনের জায়গা প্রায় লাগে না, বিজ্ঞাপন নেই',
]

export function InstallAppSection() {
  const install = useInstallState()
  const [open, setOpen] = useState(false)
  if (install.ready && install.installed && !open) return null

  return (
    <section aria-labelledby="app-title" className="border-t border-white/[0.05]">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-14 sm:py-20">
        <div className="portal-card px-5 py-8 sm:px-10 sm:py-12 grid gap-10 items-center lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
          <div className="relative">
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-sky-400">মোবাইল অ্যাপ</p>
            <h2 id="app-title" className="mt-2 text-2xl sm:text-3xl font-bold text-white">
              ফোনে অ্যাপের মতো ব্যবহার করুন
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-400 max-w-xl">
              নিচের বাটন চেপে ইনস্টল করুন। হোম স্ক্রিনের UniStream আইকন থেকে এক ট্যাপে খুলবে, আর ব্রাউজারের ঝামেলা
              ছাড়া পুরো স্ক্রিনে চলবে।
            </p>
            <ul className="mt-5 space-y-2.5 text-[14px] text-slate-300">
              {APP_POINTS.map(point => (
                <li key={point} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 mt-[3px] flex-shrink-0 text-emerald-400" aria-hidden="true" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            {install.ready && !install.installed && (
              <div className="mt-7">
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  aria-haspopup="dialog"
                  aria-expanded={open}
                  className="btn-primary w-full sm:w-auto"
                >
                  <Smartphone className="w-4 h-4" aria-hidden="true" />
                  অ্যাপ ইনস্টল করুন
                </button>
              </div>
            )}
            <InstallDialog open={open} onClose={() => setOpen(false)} />
          </div>
          <PhoneIllustration />
        </div>
      </div>
    </section>
  )
}

/** A phone home screen with the UniStream icon among neutral app tiles. */
function PhoneIllustration() {
  const apps = ['#e9c46a', '#8ab4f8', '#f4a261', '#c3a6ff', '#7fd1ae', 'brand', '#f28b82', '#9fb4c7', '#ffd166', '#a5d6a7', '#f8bbd0', '#90caf9']
  return (
    <div className="relative mx-auto w-[214px] sm:w-[236px]" aria-hidden="true">
      <div className="absolute -inset-6 rounded-[3rem] bg-indigo-500/10 blur-2xl" />
      <div className="relative rounded-[2.4rem] bg-[#16201b] p-[9px] shadow-2xl shadow-black/30">
        <div
          className="relative overflow-hidden rounded-[1.95rem] px-4 pt-3 pb-4"
          style={{ background: 'linear-gradient(165deg, #1b6b4e 0%, #0d3d2c 55%, #0a2c21 100%)' }}
        >
          <div className="flex items-center justify-between text-[9px] font-semibold text-[#fff]/80">
            <span>10:30</span>
            <span className="h-[14px] w-16 rounded-full bg-[#000]/60" />
            <span>100%</span>
          </div>
          <div className="mt-6 grid grid-cols-4 gap-x-3 gap-y-3">
            {apps.map((app, index) =>
              app === 'brand' ? (
                <span key={index} className="flex flex-col items-center gap-1">
                  <span className="relative w-full">
                    <span className="absolute -inset-1 rounded-[13px] ring-2 ring-[#6ff0b4]/80 animate-pulse" />
                    <BrandMark className="relative block w-full h-auto" />
                  </span>
                  <span className="h-[10px] flex items-center text-[8px] font-semibold text-[#fff] whitespace-nowrap">
                    UniStream
                  </span>
                </span>
              ) : (
                <span key={index} className="flex flex-col items-center gap-1">
                  <span className="block w-full aspect-square rounded-[11px] opacity-90" style={{ background: app }} />
                  <span className="h-[10px] flex items-center">
                    <span className="block h-[4px] w-7 rounded-full bg-[#fff]/30" />
                  </span>
                </span>
              ),
            )}
          </div>
          <div className="mt-14 grid grid-cols-4 gap-3 rounded-[16px] bg-[#fff]/[0.14] p-2.5">
            {['#8ab4f8', '#7fd1ae', '#f28b82', '#e9c46a'].map(color => (
              <span key={color} className="block aspect-square rounded-[10px]" style={{ background: color }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
