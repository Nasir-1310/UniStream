// frontend/app/not-found.tsx
// 404 for unknown URLs (and notFound() calls). Server component; the Navbar
// still shows the visitor's session.

import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Compass, Download, Home } from 'lucide-react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Page not found',
  description: 'This page doesn’t exist. Go to the UniStream Saver homepage or download a video.',
  robots: { index: false, follow: false },
}

export default function NotFound() {
  return (
    <div className="min-h-svh flex flex-col bg-[#0d0f1a]">
      <Navbar />
      <main id="main" className="relative z-10 flex-1 flex items-center px-4 sm:px-8 py-14 sm:py-20">
        <div className="w-full max-w-lg mx-auto text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center">
            <Compass className="w-7 h-7 text-indigo-300" aria-hidden="true" />
          </div>
          <p
            className="mt-6 text-sm font-semibold tracking-[0.2em] text-sky-400"
            style={{ fontFamily: "'Source Sans 3', sans-serif" }}
          >
            ERROR 404
          </p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-white">We can&apos;t find that page</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-400">
            The link may be mistyped, or the page may have moved. If you followed a password-reset link, request a new
            one: they expire after 60 minutes.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <Link href="/" className="btn-primary">
              <Home className="w-4 h-4" aria-hidden="true" />
              Go to homepage
            </Link>
            <Link href="/download" className="btn-secondary">
              <Download className="w-4 h-4" aria-hidden="true" />
              Download a video
            </Link>
          </div>

          <ul className="mt-10 grid gap-2 text-left sm:grid-cols-2">
            {[
              { href: '/#faq', label: 'Help & FAQ' },
              { href: '/forgot-password', label: 'Forgot password?' },
              { href: '/account', label: 'Account' },
              { href: '/terms', label: 'Terms of Use' },
            ].map(link => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="group flex items-center justify-between gap-3 min-h-12 px-4 rounded-xl border border-white/[0.07] bg-white/[0.02] text-sm text-slate-300 hover:text-white hover:border-white/[0.14] transition-colors"
                >
                  {link.label}
                  <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-slate-300 transition-colors" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <Footer />
    </div>
  )
}
