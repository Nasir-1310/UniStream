'use client'
// components/TutorialDialog.tsx
//
// "How to use" button and dialog: the guide's screen recording (when it has
// one) above its numbered steps. The guides themselves are in lib/tutorials.ts.

import { useState } from 'react'
import { BookOpen, CirclePlay } from 'lucide-react'
import { Modal } from '@/components/ui'
import type { Tutorial } from '@/lib/tutorials'

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
      size={video ? 'xl' : 'lg'}
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
      {video && (
        <div className="mb-5 overflow-hidden rounded-xl border border-white/10 bg-[#0b120e]">
          {/* Phone recordings are portrait: cap the height and centre them. */}
          <video
            src={video.src}
            poster={video.poster}
            controls
            playsInline
            preload="metadata"
            className="block mx-auto w-auto max-w-full max-h-[min(58dvh,560px)]"
          >
            আপনার ব্রাউজার এই ভিডিও চালাতে পারছে না।{' '}
            <a href={video.src} className="underline">
              ভিডিওটি আলাদা করে খুলুন
            </a>
            ।
          </video>
        </div>
      )}

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
