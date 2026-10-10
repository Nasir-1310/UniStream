// components/Footer.tsx
import Link from 'next/link'
import { Download, Facebook, Instagram, Youtube } from 'lucide-react'

// Evaluated once per page load rather than during render.
const YEAR = new Date().getFullYear()

export interface FooterProps {
  /** Show the low-key "Admin" link (landing page only). */
  showAdminLink?: boolean
}

const linkClass = 'inline-flex items-center min-h-10 px-1 text-slate-400 hover:text-white transition-colors'

export default function Footer({ showAdminLink = false }: FooterProps) {
  return (
    <footer className="relative z-10 mt-auto border-t border-white/[0.06] bg-footer/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <Link href="/" className="inline-flex items-center gap-2 rounded-lg">
              <span className="w-7 h-7 rounded-lg bg-indigo-600/90 flex items-center justify-center">
                <Download className="w-3.5 h-3.5 text-[#fff]" strokeWidth={2.5} aria-hidden="true" />
              </span>
              <span className="font-semibold text-sm text-white" style={{ fontFamily: 'var(--font-display)' }}>
                UniStream<span className="text-sky-400">Saver</span>
              </span>
            </Link>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
              YouTube, Facebook ও Instagram ভিডিও 4K পর্যন্ত কোয়ালিটিতে সেভ করুন। অনুমোদিত শিক্ষার্থীদের জন্য ফ্রি,
              অ্যাকাউন্ট অনুযায়ী প্রতিদিন আনলিমিটেড ডাউনলোড।
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">যেসব প্ল্যাটফর্ম চলে</p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-300">
              <span className="inline-flex items-center gap-1.5">
                <Youtube className="w-4 h-4 text-red-400" aria-hidden="true" /> YouTube
              </span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Facebook className="w-4 h-4 text-blue-400" aria-hidden="true" /> Facebook
              </span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Instagram className="w-4 h-4 text-pink-400" aria-hidden="true" /> Instagram
              </span>
            </p>
          </div>

          <nav aria-label="ফুটার" className="flex flex-col gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 mb-1">সাহায্য ও নীতিমালা</p>
            <ul className="flex flex-wrap gap-x-4 text-[13px] md:flex-col md:gap-x-0">
              <li>
                <Link href="/#faq" className={linkClass}>
                  সাহায্য ও প্রশ্নোত্তর
                </Link>
              </li>
              <li>
                <Link href="/terms" className={linkClass}>
                  ব্যবহারের শর্তাবলি
                </Link>
              </li>
              <li>
                <Link href="/privacy" className={linkClass}>
                  প্রাইভেসি পলিসি
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-8 pt-5 border-t border-white/[0.05] flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between text-xs text-slate-600">
          <p>
            © <span suppressHydrationWarning>{YEAR}</span> UniStream Saver। শুধু ব্যক্তিগত ও পড়াশোনার কাজে — কপিরাইট ও
            প্রতিটি প্ল্যাটফর্মের নিয়ম মেনে চলুন।
          </p>
          {showAdminLink && (
            <Link href="/admin" className="inline-flex items-center min-h-10 text-slate-600 hover:text-slate-400 transition-colors">
              Admin
            </Link>
          )}
        </div>
      </div>
    </footer>
  )
}
