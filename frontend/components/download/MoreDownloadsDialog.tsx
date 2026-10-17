'use client'
// components/download/MoreDownloadsDialog.tsx
//
// Shown when someone with a daily limit tries to download past it: today's
// count is used up, and more downloads come with a subscription arranged
// directly with us, so WhatsApp and Gmail are one tap away (with a message
// already written that says who is asking).

import { Crown, Mail } from 'lucide-react'
import { Modal } from '@/components/ui'
import { WhatsAppIcon } from '@/components/ContactCard'
import type { PublicUser, Usage } from '@/lib/api'
import { CONTACT } from '@/lib/contact'
import { formatPhone } from '@/lib/format'
import { resetTimeText } from './QuotaCard'

export function MoreDownloadsDialog({
  open,
  onClose,
  user,
  usage,
}: {
  open: boolean
  onClose: () => void
  user: PublicUser
  usage: Usage
}) {
  const turnedOff = usage.limit === 0
  const account = [user.name, user.email || formatPhone(user.phone)].filter(Boolean).join(', ')
  const message =
    `আসসালামু আলাইকুম। আমি UniStream Downloader-এ আরও বেশি ভিডিও ডাউনলোড করতে চাই। ` +
    `সাবস্ক্রিপশনের বিস্তারিত জানাবেন।${account ? `\nআমার অ্যাকাউন্ট: ${account}` : ''}`
  const whatsappHref = `${CONTACT.whatsappLink}?text=${encodeURIComponent(message)}`
  const mailHref =
    `mailto:${CONTACT.email}?subject=${encodeURIComponent('UniStream Downloader: আরও ডাউনলোডের সাবস্ক্রিপশন')}` +
    `&body=${encodeURIComponent(message)}`

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      icon={
        <span className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
          <Crown className="w-5 h-5 text-amber-300" aria-hidden="true" />
        </span>
      }
      title="আরও ভিডিও ডাউনলোড করতে চান?"
      description={
        turnedOff
          ? 'আপনার অ্যাকাউন্টে এখন ডাউনলোড বন্ধ আছে।'
          : `আজকের ডাউনলোডের সীমা শেষ। ফ্রি ডাউনলোড আবার চালু হবে ${resetTimeText(usage)}-এ।`
      }
      footer={
        <button type="button" onClick={onClose} className="btn-secondary">
          বন্ধ করুন
        </button>
      }
    >
      <div className="rounded-2xl border border-indigo-500/25 bg-indigo-500/[0.06] p-4">
        <p className="text-[15px] font-semibold text-white">সাবস্ক্রিপশন নিয়ে আরও বেশি ডাউনলোড করুন</p>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-300">
          আপনার কতগুলো ডাউনলোড দরকার জানিয়ে আমাদের সাথে যোগাযোগ করুন। কথা বলে আপনার প্রয়োজন অনুযায়ী প্ল্যান ঠিক করে
          দেব, তারপর আপনার অ্যাকাউন্টে বাড়তি ডাউনলোড চালু হয়ে যাবে।
        </p>
      </div>

      <div className="mt-4 grid gap-2.5">
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary !bg-[#1fa855] hover:!bg-[#178f47] w-full"
          data-autofocus
        >
          <WhatsAppIcon className="w-5 h-5" />
          WhatsApp: {CONTACT.whatsapp}
        </a>
        <a href={mailHref} className="btn-secondary w-full">
          <Mail className="w-4 h-4" aria-hidden="true" />
          <span className="break-all">{CONTACT.email}</span>
        </a>
      </div>
      <p className="mt-3 text-center text-[12px] leading-relaxed text-slate-500">
        বাটন চাপলে মেসেজ লেখা অবস্থায় খুলবে, শুধু পাঠিয়ে দিন।
      </p>
    </Modal>
  )
}

export default MoreDownloadsDialog
