'use client'
// components/InstallApp.tsx
//
// Installing the site as an app (PWA): the install button, the step-by-step
// guide for browsers without an install dialog (iPhone Safari, Firefox, ...),
// the dismissible banner on the download page and the landing page section.
// Nothing renders inside the installed app itself.

import { useState, type ReactNode } from 'react'
import {
  CheckCircle2,
  Laptop,
  MonitorDown,
  MoreVertical,
  Share,
  Smartphone,
  SquarePlus,
  X,
} from 'lucide-react'
import { Alert, Modal, useToast } from '@/components/ui'
import { BrandMark } from '@/components/Brand'
import { promptInstall, useInstallState, type InstallPlatform } from '@/lib/pwa'

// ── Install button ────────────────────────────────────────────────────────────

export interface InstallButtonProps {
  className?: string
  label?: string
  /** Hide the icon (e.g. in a text link). */
  plain?: boolean
}

/**
 * Opens the browser's install dialog where there is one, otherwise the guide.
 * Renders nothing in the installed app and before hydration.
 */
export function InstallButton({ className = 'btn-primary', label = 'অ্যাপ ইনস্টল করুন', plain = false }: InstallButtonProps) {
  const install = useInstallState()
  const { open, start, guide } = useInstallFlow()
  if (!install.ready || install.installed) return null
  const Icon = install.platform === 'desktop' ? MonitorDown : Smartphone
  return (
    <>
      <button type="button" onClick={start} aria-haspopup="dialog" aria-expanded={open} className={className}>
        {!plain && <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />}
        {label}
      </button>
      {guide}
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

/** Shared by every install entry point: try the dialog, fall back to the guide. */
function useInstallFlow() {
  const install = useInstallState()
  const toast = useToast()
  const [open, setOpen] = useState(false)

  async function start() {
    const outcome = await promptInstall()
    if (outcome === 'accepted') {
      toast.success('অ্যাপ ইনস্টল হচ্ছে', {
        description: 'কিছুক্ষণের মধ্যে হোম স্ক্রিনে UniStream আইকন দেখতে পাবেন।',
      })
    } else if (outcome === 'unavailable') {
      setOpen(true)
    }
  }

  const guide = (
    <InstallGuideModal
      open={open}
      onClose={() => setOpen(false)}
      platform={install.platform}
      inAppBrowser={install.inAppBrowser}
    />
  )
  return { open, start, guide }
}

// ── Step-by-step guide ────────────────────────────────────────────────────────

const PLATFORM_TABS: { id: InstallPlatform; label: string; Icon: typeof Smartphone }[] = [
  { id: 'android', label: 'Android', Icon: Smartphone },
  { id: 'ios', label: 'iPhone', Icon: Smartphone },
  { id: 'desktop', label: 'কম্পিউটার', Icon: Laptop },
]

const GUIDE_STEPS: Record<InstallPlatform, { browser: string; steps: ReactNode[] }> = {
  android: {
    browser: 'Chrome-এ সাইটটি খুলে:',
    steps: [
      <>
        ওপরে ডান কোণের <Kbd label="তিন-ডট"><MoreVertical className="w-3.5 h-3.5" /></Kbd> মেনু চাপুন।
      </>,
      <>
        <strong className="text-slate-100">“Install app”</strong> বা{' '}
        <strong className="text-slate-100">“Add to Home screen”</strong> বেছে নিন।
      </>,
      <>
        <strong className="text-slate-100">Install</strong> চাপুন। হোম স্ক্রিনে UniStream আইকন চলে আসবে।
      </>,
    ],
  },
  ios: {
    browser: 'Safari-তে সাইটটি খুলে:',
    steps: [
      <>
        নিচের <Kbd label="Share"><Share className="w-3.5 h-3.5" /></Kbd> Share বাটন চাপুন।
      </>,
      <>
        একটু নিচে স্ক্রল করে{' '}
        <strong className="text-slate-100">
          “Add to Home Screen” <SquarePlus className="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" />
        </strong>{' '}
        বেছে নিন।
      </>,
      <>
        ওপরে ডানে <strong className="text-slate-100">Add</strong> চাপুন। হোম স্ক্রিনে UniStream আইকন চলে আসবে।
      </>,
    ],
  },
  desktop: {
    browser: 'Chrome বা Edge-এ সাইটটি খুলে:',
    steps: [
      <>
        অ্যাড্রেস বারের ডান পাশের <Kbd label="ইনস্টল"><MonitorDown className="w-3.5 h-3.5" /></Kbd> ইনস্টল আইকনে
        ক্লিক করুন।
      </>,
      <>
        আইকন না দেখলে <Kbd label="তিন-ডট"><MoreVertical className="w-3.5 h-3.5" /></Kbd> মেনু থেকে{' '}
        <strong className="text-slate-100">“Install UniStream Downloader”</strong> বেছে নিন।
      </>,
      <>
        <strong className="text-slate-100">Install</strong> চাপুন। ডেস্কটপ আর স্টার্ট মেনু থেকে আলাদা অ্যাপের মতো খুলবে।
      </>,
    ],
  },
}

/** A small key-cap showing the icon of the browser button to press. */
function Kbd({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center align-middle mx-0.5 w-6 h-6 rounded-md border border-white/15 bg-white/[0.06] text-slate-200">
      <span aria-hidden="true" className="inline-flex">
        {children}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function InstallGuideModal({
  open,
  onClose,
  platform,
  inAppBrowser,
}: {
  open: boolean
  onClose: () => void
  platform: InstallPlatform
  inAppBrowser: boolean
}) {
  const [tab, setTab] = useState<InstallPlatform | null>(null)
  const active = tab ?? platform
  const guide = GUIDE_STEPS[active]

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      icon={<BrandMark className="w-10 h-10" />}
      title="অ্যাপ হিসেবে ইনস্টল করুন"
      description="Play Store লাগবে না। ফোনের হোম স্ক্রিনে UniStream আইকন আসবে, এক ট্যাপে খুলবে।"
      footer={
        <button type="button" onClick={onClose} className="btn-primary" data-autofocus>
          ঠিক আছে
        </button>
      }
    >
      {inAppBrowser && (
        <Alert tone="info" title="আগে Chrome বা Safari-তে খুলুন" className="mb-4">
          Facebook, Messenger বা Instagram-এর ভেতরের ব্রাউজার থেকে অ্যাপ ইনস্টল করা যায় না। ⋮ বা ··· মেনু থেকে
          “Open in browser” বেছে নিন।
        </Alert>
      )}

      <div role="group" aria-label="আপনার ডিভাইস" className="grid grid-cols-3 gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
        {PLATFORM_TABS.map(({ id, label, Icon }) => {
          const selected = id === active
          return (
            <button
              key={id}
              type="button"
              aria-pressed={selected}
              onClick={() => setTab(id)}
              className={`inline-flex items-center justify-center gap-1.5 h-10 rounded-lg text-[13px] font-semibold transition-colors ${
                selected ? 'bg-indigo-600 text-[#fff] shadow-sm' : 'text-slate-300 hover:bg-white/[0.06]'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              {label}
            </button>
          )
        })}
      </div>

      <div className="mt-4" aria-live="polite">
        <p className="text-[13px] font-medium text-slate-400">{guide.browser}</p>
        <ol className="mt-3 space-y-3">
          {guide.steps.map((step, index) => (
            <li key={index} className="flex gap-3">
              <span
                className="w-7 h-7 flex-shrink-0 rounded-full bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 text-[13px] font-bold flex items-center justify-center"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <p className="pt-1 text-[14px] leading-relaxed text-slate-300">{step}</p>
            </li>
          ))}
        </ol>
      </div>
    </Modal>
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

/** "Install the app" strip; × hides it for 30 days. */
export function InstallBanner() {
  const install = useInstallState()
  const { open, start, guide } = useInstallFlow()
  const [hidden, setHidden] = useState(() => typeof window !== 'undefined' && bannerHiddenRecently())
  if (!install.ready || install.installed || install.inAppBrowser || hidden) return null

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
        <p className="text-[12.5px] leading-snug text-slate-400">
          হোম স্ক্রিন থেকে এক ট্যাপে খুলুন, Play Store লাগবে না।
        </p>
      </div>
      <button type="button" onClick={start} aria-haspopup="dialog" aria-expanded={open} className="btn-primary btn-sm flex-shrink-0">
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
      {guide}
    </div>
  )
}

// ── Landing page section ──────────────────────────────────────────────────────

const APP_POINTS = [
  'Android, iPhone আর কম্পিউটার — সবখানে চলে',
  'ফোনের জায়গা প্রায় লাগে না, বিজ্ঞাপন নেই',
  'নতুন ফিচার নিজে থেকেই আপডেট হয়',
]

export function InstallAppSection() {
  const install = useInstallState()
  const { open, start, guide } = useInstallFlow()
  if (install.ready && install.installed) return null

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
              Play Store ছাড়াই কয়েক সেকেন্ডে ইনস্টল হয়। হোম স্ক্রিনের UniStream আইকন থেকে এক ট্যাপে খুলবে, আর
              ব্রাউজারের ঝামেলা ছাড়া পুরো স্ক্রিনে চলবে।
            </p>
            <ul className="mt-5 space-y-2.5 text-[14px] text-slate-300">
              {APP_POINTS.map(point => (
                <li key={point} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 mt-[3px] flex-shrink-0 text-emerald-400" aria-hidden="true" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              {install.ready && (
                <button type="button" onClick={start} aria-haspopup="dialog" aria-expanded={open} className="btn-primary">
                  <Smartphone className="w-4 h-4" aria-hidden="true" />
                  অ্যাপ ইনস্টল করুন
                </button>
              )}
            </div>
            {guide}
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
