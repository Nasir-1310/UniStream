'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { checkAccess } from '@/lib/api'
import {
  Download, Shield, Youtube, Facebook, Instagram,
  Music, Wifi, ChevronRight, AlertCircle, CheckCircle2,
  Loader2, Smartphone
} from 'lucide-react'

export default function HomePage() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!identifier.trim()) return
    setChecking(true)
    setLoading(true)
    setError('')

    try {
      const res = await checkAccess(identifier.trim())
      if (res.access) {
        // Store in sessionStorage so downloader knows who's accessing
        sessionStorage.setItem('us_identifier', identifier.trim())
        sessionStorage.setItem('us_name', res.name || '')
        router.push('/download')
      } else {
        setError(res.message)
      }
    } catch {
      setError('সার্ভারের সাথে সংযোগ করা যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।')
    } finally {
      setLoading(false)
      setChecking(false)
    }
  }

  const platforms = [
    { icon: <Youtube className="w-5 h-5" />, name: 'YouTube', color: 'text-red-400' },
    { icon: <Facebook className="w-5 h-5" />, name: 'Facebook', color: 'text-blue-400' },
    { icon: <Instagram className="w-5 h-5" />, name: 'Instagram', color: 'text-pink-400' },
    { icon: <Music className="w-5 h-5" />, name: 'TikTok', color: 'text-cyan-400' },
  ]

  const features = [
    { icon: '🎬', label: '1080p / 720p HD', desc: 'Full quality video' },
    { icon: '📱', label: '480p / 360p', desc: 'Data saving quality' },
    { icon: '🎵', label: 'MP3 Audio', desc: 'Audio only extraction' },
    { icon: '⚡', label: 'Fast Download', desc: 'Direct stream links' },
  ]

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ── */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
            <Download className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white">UniStream Saver</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <Shield className="w-3 h-3 text-brand-500" />
          Secured Access
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        {/* ── Hero ── */}
        <div className="text-center mb-10 max-w-lg">
          <div className="inline-flex items-center gap-2 bg-brand-500/10 border border-brand-500/20 text-brand-400 text-xs font-medium px-3 py-1.5 rounded-full mb-5">
            <Smartphone className="w-3 h-3" /> University Students Only
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3 leading-tight">
            যেকোনো ভিডিও<br />
            <span className="text-brand-500">ডাউনলোড করুন</span> সহজে
          </h1>

          <p className="text-gray-400 text-sm sm:text-base leading-relaxed">
            YouTube, Facebook, Instagram, TikTok — সব প্ল্যাটফর্ম থেকে
            আপনার পছন্দের কোয়ালিটিতে ভিডিও ডাউনলোড করুন।
            শুধুমাত্র <strong className="text-white">অ্যাপ্রুভড স্টুডেন্টদের</strong> জন্য।
          </p>
        </div>

        {/* ── Platforms ── */}
        <div className="flex gap-4 mb-8">
          {platforms.map(p => (
            <div key={p.name} className="flex flex-col items-center gap-1">
              <div className={`${p.color} glass p-2.5 rounded-xl`}>{p.icon}</div>
              <span className="text-xs text-gray-500">{p.name}</span>
            </div>
          ))}
        </div>

        {/* ── Access Check Card ── */}
        <div className="w-full max-w-md glass p-6 mb-8">
          <div className="flex items-center gap-2 mb-5">
            <Shield className="w-4 h-4 text-brand-500" />
            <span className="font-semibold text-white text-sm">অ্যাক্সেস যাচাই করুন</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                আপনার Gmail বা ফোন নম্বর লিখুন
              </label>
              <input
                type="text"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="example@gmail.com অথবা 01XXXXXXXXX"
                className="input-field"
                disabled={loading}
                autoComplete="email"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg px-3 py-2.5">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2" disabled={loading || !identifier.trim()}>
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> যাচাই হচ্ছে...</>
              ) : (
                <><CheckCircle2 className="w-4 h-4" /> অ্যাক্সেস চেক করুন <ChevronRight className="w-4 h-4" /></>
              )}
            </button>
          </form>

          <p className="text-xs text-gray-600 mt-4 text-center">
            অ্যাক্সেস নেই? আপনার বিশ্ববিদ্যালয়ের অ্যাডমিনের সাথে যোগাযোগ করুন।
          </p>
        </div>

        {/* ── Features ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-md sm:max-w-xl">
          {features.map(f => (
            <div key={f.label} className="glass p-3 text-center">
              <div className="text-2xl mb-1">{f.icon}</div>
              <div className="text-xs font-semibold text-white">{f.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{f.desc}</div>
            </div>
          ))}
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-border px-4 py-4 text-center text-xs text-gray-600">
        <div className="flex items-center justify-center gap-1 mb-1">
          <Wifi className="w-3 h-3 text-brand-500" />
          <span className="text-brand-600">UniStream Saver</span>
          <span>— University Students Video Downloader</span>
        </div>
        <p>ভিডিও ডাউনলোড শুধুমাত্র ব্যক্তিগত ব্যবহারের জন্য। কপিরাইট আইন মেনে চলুন।</p>
      </footer>
    </div>
  )
}
