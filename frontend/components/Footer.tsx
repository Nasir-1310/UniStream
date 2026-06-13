// components/Footer.tsx
import { Download } from 'lucide-react'
import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/5">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <div className="w-4 h-4 rounded bg-indigo-600/20 flex items-center justify-center">
            <Download className="w-2.5 h-2.5 text-indigo-400" />
          </div>
          <span className="text-indigo-400 font-semibold">UniStreamSaver</span>
          <span>— Video Downloader</span>
        </div>
        <div className="flex items-center gap-5 text-xs text-slate-600">
          <span>For personal use only. Respect copyright laws.</span>
          <Link href="/privacy" className="hover:text-slate-400 transition-colors">Privacy</Link>
          <Link href="/terms" className="hover:text-slate-400 transition-colors">Terms</Link>
        </div>
      </div>
    </footer>
  )
}