'use client'
// components/TutorialDialog.tsx
//
// "How to use" button and dialog: the guide's screen recording (when it has
// one) above its numbered steps. Phones get the portrait recording, laptops
// and desktops the landscape one. The guides themselves are in lib/tutorials.ts.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BookOpen, CirclePlay } from 'lucide-react'
import { Modal, Spinner } from '@/components/ui'
import type { Tutorial, TutorialVideo } from '@/lib/tutorials'

/** Phone-sized screens get the portrait recording. */
const PHONE_QUERY = '(max-width: 767px)'

function subscribePhone(callback: () => void): () => void {
  const query = window.matchMedia(PHONE_QUERY)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}

function usePhoneScreen(): boolean {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false)
}

export interface TutorialButtonProps {
  tutorial: Tutorial
  /** Default: "ভিডিও দেখে শিখুন" with a recording, else "কীভাবে ব্যবহার করবেন". */
  label?: string
  /** Shorter label below the `sm` breakpoint (narrow phones). */
  shortLabel?: string
  className?: string
}

export function TutorialButton({ tutorial, label, shortLabel, className = 'btn-secondary' }: TutorialButtonProps) {
  const [open, setOpen] = useState(false)
  const Icon = tutorial.video ? CirclePlay : BookOpen
  const fullLabel = label ?? (tutorial.video ? 'ভিডিও দেখে শিখুন' : 'কীভাবে ব্যবহার করবেন')
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={className}
      >
        <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        {shortLabel ? (
          <>
            <span className="sm:hidden">{shortLabel}</span>
            <span className="hidden sm:inline">{fullLabel}</span>
          </>
        ) : (
          fullLabel
        )}
      </button>
      <TutorialModal tutorial={tutorial} open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function TutorialModal({ tutorial, open, onClose }: { tutorial: Tutorial; open: boolean; onClose: () => void }) {
  const { video } = tutorial
  return (
    <Modal
      open={open}
      onClose={onClose}
      size={video ? 'video' : 'lg'}
      icon={
        <span className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
          {video ? (
            <CirclePlay className="w-5 h-5 text-indigo-300" aria-hidden="true" />
          ) : (
            <BookOpen className="w-5 h-5 text-indigo-300" aria-hidden="true" />
          )}
        </span>
      }
      title={tutorial.title}
      description={tutorial.description}
      footer={
        <button type="button" onClick={onClose} className="btn-primary" data-autofocus>
          বুঝেছি
        </button>
      }
    >
      {video && <TutorialVideoPlayer video={video} />}

      {video && <h3 className="mb-3 text-[13px] font-semibold text-slate-400">ধাপে ধাপে</h3>}
      <ol className="space-y-3.5">
        {tutorial.steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span
              className="w-7 h-7 flex-shrink-0 rounded-full bg-indigo-600 text-[#fff] text-[13px] font-bold flex items-center justify-center"
              style={{ fontFamily: 'var(--font-display)' }}
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[14px] font-semibold text-white">
                <span className="sr-only">ধাপ {index + 1}: </span>
                {step.title}
              </p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-slate-400">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </Modal>
  )
}

/**
 * The recording, sized for the screen: portrait on phones (as tall as fits),
 * landscape on laptops (full width). The width/height attributes reserve the
 * right shape before anything loads, so the dialog doesn't jump. It starts
 * playing as the dialog opens (that tap allows sound); if the browser
 * declines, its own play button is there.
 */
function TutorialVideoPlayer({ video }: { video: TutorialVideo }) {
  const phone = usePhoneScreen()
  const portrait = phone && Boolean(video.mobileSrc)
  const src = portrait && video.mobileSrc ? video.mobileSrc : video.src
  const poster = portrait ? video.mobilePoster ?? video.poster : video.poster
  const ref = useRef<HTMLVideoElement>(null)
  const [buffering, setBuffering] = useState(true)

  useEffect(() => {
    ref.current?.play().catch(() => setBuffering(false))
  }, [src])

  return (
    <div className="relative mb-5 overflow-hidden rounded-xl border border-white/10 bg-[#0b120e]">
      <video
        key={src}
        ref={ref}
        src={src}
        poster={poster}
        width={portrait ? 720 : 1280}
        height={portrait ? 1280 : 720}
        controls
        playsInline
        preload="auto"
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onPause={() => setBuffering(false)}
        onError={() => setBuffering(false)}
        className={portrait ? 'block mx-auto h-[min(62dvh,640px)] w-auto max-w-full' : 'block w-full h-auto'}
      >
        আপনার ব্রাউজার এই ভিডিও চালাতে পারছে না।{' '}
        <a href={src} className="underline">
          ভিডিওটি আলাদা করে খুলুন
        </a>
        ।
      </video>
      {buffering && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <span className="w-14 h-14 rounded-full bg-[#000]/45 flex items-center justify-center">
            <Spinner size="lg" label={null} className="text-[#fff]" />
          </span>
        </span>
      )}
    </div>
  )
}
