// components/ContactCard.tsx
//
// "Contact & help": who built UniStream Saver and how to reach him on
// WhatsApp or by email. On the home page, right above the footer.

import { Mail } from 'lucide-react'
import { CONTACT, CONTACT_MAILTO } from '@/lib/contact'

/** WhatsApp's mark (lucide has no brand icon for it). */
export function WhatsAppIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.25 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.17.24-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.43-.06-.13-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  )
}

export function ContactSection() {
  return (
    <section aria-labelledby="contact-title" id="contact" className="border-t border-white/[0.05] scroll-mt-14">
      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-14 sm:py-20">
        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-sky-400">যোগাযোগ ও সাহায্য</p>
        <h2 id="contact-title" className="mt-2 text-2xl sm:text-3xl font-bold text-white">
          কিছু বুঝতে সমস্যা? সরাসরি যোগাযোগ করুন
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-slate-400 max-w-2xl">
          অ্যাকাউন্ট, ডাউনলোড বা অন্য যেকোনো বিষয়ে সাহায্য লাগলে WhatsApp বা ইমেইলে লিখুন। যত দ্রুত সম্ভব উত্তর দেওয়ার চেষ্টা
          করি।
        </p>

        <div className="mt-8 portal-card p-5 sm:p-7">
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4 min-w-0">
              <span
                className="w-16 h-16 flex-shrink-0 rounded-2xl bg-indigo-600 text-[#fff] flex items-center justify-center text-xl font-bold"
                aria-hidden="true"
              >
                NU
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-indigo-300">নির্মাতা ও পরিচালক</p>
                <p className="mt-0.5 text-lg font-bold text-white">{CONTACT.name}</p>
                <p className="text-[13px] text-slate-400">{CONTACT.role}</p>
              </div>
            </div>

            <div className="grid gap-2.5 sm:min-w-[250px]">
              <a
                href={CONTACT.whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary !bg-[#1fa855] hover:!bg-[#178f47]"
                aria-label={`WhatsApp-এ মেসেজ দিন: ${CONTACT.whatsapp}`}
              >
                <WhatsAppIcon className="w-5 h-5" />
                WhatsApp: {CONTACT.whatsapp}
              </a>
              <a href={CONTACT_MAILTO} className="btn-secondary" aria-label={`ইমেইল পাঠান: ${CONTACT.email}`}>
                <Mail className="w-4 h-4" aria-hidden="true" />
                <span className="break-all">{CONTACT.email}</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default ContactSection
