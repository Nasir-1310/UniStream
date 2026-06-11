'use client'
// frontend/app/page.tsx
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { checkAccess } from '@/lib/api'
import {
  Download, ShieldCheck, Youtube, Facebook, Instagram,
  Music2, Wifi, AlertCircle, CheckCircle2,
  Loader2, GraduationCap, Zap, Video, Headphones,
  Smartphone, Star, Lock, ArrowRight, Mail, Phone, X
} from 'lucide-react'

// ── Validation helpers ────────────────────────────────────────────────────────

/** Exactly: <word chars or dots>@gmail.com — case-insensitive */
const GMAIL_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._+\-]{0,62}[a-zA-Z0-9])?@gmail\.com$/i

/**
 * Bangladesh mobile numbers:
 *  - Optionally starts with +880 or 880 (country code)
 *  - Then an 11-digit number starting with 01
 *  - Operators: 013x, 014x, 015x, 016x, 017x, 018x, 019x
 *  - Spaces, dashes, dots between groups are accepted
 */
const BD_PHONE_RE = /^(?:\+?880)?01[3-9]\d{8}$/

type FieldType = 'gmail' | 'phone' | null

interface ValidationResult {
  type: FieldType
  valid: boolean
  /** Only set when the field has content but is invalid */
  hint: string
}

function validate(raw: string): ValidationResult {
  const v = raw.trim().replace(/[\s\-.()\u00A0]/g, '') // strip spaces/dashes

  if (!v) return { type: null, valid: false, hint: '' }

  // Looks like it's meant to be an email (contains @)
  if (v.includes('@')) {
    if (GMAIL_RE.test(v)) return { type: 'gmail', valid: true, hint: '' }
    if (!v.includes('.')) return { type: 'gmail', valid: false, hint: 'Missing domain — did you mean @gmail.com?' }
    if (!v.toLowerCase().endsWith('@gmail.com')) return { type: 'gmail', valid: false, hint: 'Only @gmail.com addresses are accepted.' }
    return { type: 'gmail', valid: false, hint: 'Check your email address — something looks off.' }
  }

  // Looks like it's meant to be a phone number (all digits or starts with +)
  if (/^[\d+]/.test(v)) {
    const digits = v.replace(/\D/g, '')
    if (BD_PHONE_RE.test(v)) return { type: 'phone', valid: true, hint: '' }
    if (digits.length < 11) return { type: 'phone', valid: false, hint: `Too short — Bangladeshi numbers need 11 digits (e.g. 01XXXXXXXXX).` }
    if (digits.length > 13) return { type: 'phone', valid: false, hint: 'Too long — check your number.' }
    if (!digits.replace(/^880/, '').startsWith('01')) return { type: 'phone', valid: false, hint: 'Number must start with 01 (e.g. 017XXXXXXXX).' }
    const op = parseInt(digits.replace(/^(?:880)?0?1/, '').charAt(0))
    if (op < 3 || op > 9) return { type: 'phone', valid: false, hint: 'Unrecognised operator prefix — use 013–019.' }
    return { type: 'phone', valid: false, hint: 'Invalid number — use format 01XXXXXXXXX.' }
  }

  // Ambiguous / neither
  return { type: null, valid: false, hint: 'Enter a Gmail address or a Bangladeshi phone number (01XXXXXXXXX).' }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function HomePage() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [touched, setTouched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [serverError, setServerError] = useState('')

  const validation = useMemo(() => validate(identifier), [identifier])

  // Show inline hint only after user has typed something and blurred, or tried to submit
  const showHint = touched && identifier.trim().length > 0 && !validation.valid && validation.hint

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!validation.valid) return

    setLoading(true)
    setServerError('')
    try {
      const res = await checkAccess(identifier.trim())
      if (res.access) {
        sessionStorage.setItem('us_identifier', identifier.trim())
        sessionStorage.setItem('us_name', res.name || '')
        router.push('/download')
      } else {
        setServerError(res.message)
      }
    } catch {
      setServerError('Unable to connect to the server. Please try again later.')
    } finally {
      setLoading(false)
    }
  }

  function handleChange(v: string) {
    setIdentifier(v)
    setServerError('')
    // Once touched, keep showing hints live
  }

  // Dynamic input border colour
  const inputBorderClass =
    !touched || !identifier.trim()
      ? 'input-field'
      : validation.valid
      ? 'input-field input-valid'
      : 'input-field input-error'

  const platforms = [
    { icon: <Youtube className="w-5 h-5" />, name: 'YouTube', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', desc: 'All resolutions' },
    { icon: <Facebook className="w-5 h-5" />, name: 'Facebook', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', desc: 'Reels & videos' },
    { icon: <Instagram className="w-5 h-5" />, name: 'Instagram', color: 'text-pink-400', bg: 'bg-pink-500/10 border-pink-500/20', desc: 'Posts & stories' },
    { icon: <Music2 className="w-5 h-5" />, name: 'TikTok', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20', desc: 'No watermark' },
  ]

  const features = [
    { icon: <Video className="w-5 h-5 text-brand-400" />, label: '4K / 1080p HD', desc: 'Crystal-clear video at full resolution' },
    { icon: <Smartphone className="w-5 h-5 text-purple-400" />, label: '480p / 360p', desc: 'Bandwidth-friendly mobile quality' },
    { icon: <Headphones className="w-5 h-5 text-pink-400" />, label: 'MP3 Audio', desc: 'Extract clean audio from any video' },
    { icon: <Zap className="w-5 h-5 text-yellow-400" />, label: 'Instant Links', desc: 'Direct stream — no waiting' },
  ]

  const stats = [
    { value: '10K+', label: 'Downloads daily' },
    { value: '4', label: 'Platforms supported' },
    { value: '99.9%', label: 'Uptime' },
    { value: '0s', label: 'Processing delay' },
  ]

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0d14]">

      {/* ── Ambient glow ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-brand-500/5 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-purple-500/5 blur-[100px]" />
      </div>

      {/* ── Header ── */}
      <header className="relative z-10 border-b border-white/5 px-4 sm:px-6 py-4 flex items-center justify-between max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-500 rounded-xl flex items-center justify-center shadow-lg shadow-brand-500/30">
            <Download className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <span className="font-bold text-white text-sm tracking-tight">UniStream Saver</span>
            <span className="hidden sm:block text-xs text-gray-500 leading-none mt-0.5">University Video Downloader</span>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-brand-500/10 border border-brand-500/20 px-3 py-1.5 rounded-full">
          <ShieldCheck className="w-3.5 h-3.5 text-brand-400" />
          <span className="text-xs font-medium text-brand-300">Secure Access</span>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col">

        {/* ── Hero ── */}
        <section className="flex flex-col items-center text-center px-4 pt-16 pb-12 sm:pt-24 sm:pb-16">
          <div className="inline-flex items-center gap-2 bg-brand-500/10 border border-brand-500/20 text-brand-300 text-xs font-semibold px-4 py-2 rounded-full mb-7 tracking-wide uppercase">
            <GraduationCap className="w-3.5 h-3.5" />
            Approved Students Only
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white mb-5 leading-[1.1] tracking-tight max-w-2xl">
            Download Any Video{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 to-emerald-300">
              Instantly
            </span>
          </h1>
          <p className="text-gray-400 text-base sm:text-lg leading-relaxed max-w-xl mb-10">
            YouTube, Facebook, Instagram, TikTok — pick any quality, from 4K down to data-saving 360p.
            Available exclusively for{' '}
            <strong className="text-gray-200 font-semibold">verified university students</strong>.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mb-6">
            {platforms.map(p => (
              <div key={p.name} className={`flex items-center gap-2 ${p.bg} border px-4 py-2 rounded-full transition-transform hover:scale-105`}>
                <span className={p.color}>{p.icon}</span>
                <span className="text-sm font-medium text-white">{p.name}</span>
                <span className="hidden sm:inline text-xs text-gray-500">· {p.desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Stats bar ── */}
        <section className="px-4 pb-12 sm:pb-16">
          <div className="max-w-2xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/5 rounded-2xl overflow-hidden border border-white/5">
            {stats.map(s => (
              <div key={s.label} className="bg-[#0a0d14] flex flex-col items-center py-4 px-2">
                <span className="text-xl font-bold text-white">{s.value}</span>
                <span className="text-xs text-gray-500 mt-0.5">{s.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Access check + features ── */}
        <section className="px-4 pb-20 flex flex-col lg:flex-row gap-6 max-w-5xl mx-auto w-full">

          {/* ── Left: Access check card ── */}
          <div className="flex-1 max-w-md mx-auto lg:mx-0">
            <div className="glass p-8 rounded-2xl">

              {/* Card header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-brand-500/15 rounded-xl flex items-center justify-center">
                  <Lock className="w-5 h-5 text-brand-400" />
                </div>
                <div>
                  <h2 className="text-white font-bold text-base">Verify Your Access</h2>
                  <p className="text-gray-500 text-xs mt-0.5">Enter your Gmail or phone number</p>
                </div>
              </div>

              <form onSubmit={handleSubmit} noValidate className="space-y-4">

                {/* ── Input with floating type icon + clear button ── */}
                <div>
                  <label htmlFor="identifier" className="block text-xs font-medium text-gray-400 mb-2">
                    Gmail address or phone number
                  </label>

                  <div className="relative">
                    {/* Detected-type icon on the left */}
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                      {validation.type === 'gmail'
                        ? <Mail className="w-4 h-4 text-brand-400" />
                        : validation.type === 'phone'
                        ? <Phone className="w-4 h-4 text-brand-400" />
                        : <Lock className="w-4 h-4" />
                      }
                    </div>

                    <input
                      id="identifier"
                      type="text"
                      inputMode={validation.type === 'phone' ? 'tel' : 'email'}
                      value={identifier}
                      onChange={e => handleChange(e.target.value)}
                      onBlur={() => setTouched(true)}
                      placeholder="you@gmail.com  or  01XXXXXXXXX"
                      className={`${inputBorderClass} pl-10 pr-20`}
                      disabled={loading}
                      autoComplete="email"
                      aria-describedby={showHint ? 'field-hint' : undefined}
                      aria-invalid={touched && !validation.valid && identifier.trim().length > 0}
                    />

                    {/* Right-side indicators: clear button + validation tick/cross */}
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                      {identifier.length > 0 && !loading && (
                        <button
                          type="button"
                          onClick={() => { setIdentifier(''); setTouched(false); setServerError('') }}
                          className="p-0.5 rounded-full text-gray-600 hover:text-gray-300 transition-colors"
                          aria-label="Clear input"
                          tabIndex={-1}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {touched && identifier.trim().length > 0 && (
                        validation.valid
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          : <AlertCircle  className="w-4 h-4 text-red-400 flex-shrink-0" />
                      )}
                    </div>
                  </div>

                  {/* Inline validation hint — animates in */}
                  {showHint && (
                    <p id="field-hint" role="alert" className="mt-2 text-xs text-red-400 flex items-start gap-1.5 fade-up">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      {validation.hint}
                    </p>
                  )}

                  {/* Valid confirmation hint */}
                  {touched && validation.valid && (
                    <p className="mt-2 text-xs text-emerald-400 flex items-center gap-1.5 fade-up">
                      <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                      {validation.type === 'gmail' ? 'Valid Gmail address' : 'Valid Bangladeshi phone number'}
                    </p>
                  )}
                </div>

                {/* Accepted formats helper */}
                {!touched && (
                  <div className="flex gap-3">
                    <div className="flex-1 flex items-center gap-2 bg-white/3 border border-white/6 rounded-lg px-3 py-2">
                      <Mail className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                      <span className="text-xs text-gray-600">you@gmail.com</span>
                    </div>
                    <div className="flex-1 flex items-center gap-2 bg-white/3 border border-white/6 rounded-lg px-3 py-2">
                      <Phone className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                      <span className="text-xs text-gray-600">01XXXXXXXXX</span>
                    </div>
                  </div>
                )}

                {/* Server-side error */}
                {serverError && (
                  <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 text-red-300 text-sm rounded-xl px-4 py-3">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{serverError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  className="btn-primary w-full flex items-center justify-center gap-2"
                  disabled={loading || (touched && !validation.valid)}
                >
                  {loading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Verifying access…</>
                  ) : (
                    <><CheckCircle2 className="w-4 h-4" /> Check Access <ArrowRight className="w-4 h-4 ml-auto" /></>
                  )}
                </button>
              </form>

              <div className="mt-5 pt-5 border-t border-white/5 flex items-start gap-2 text-xs text-gray-600">
                <ShieldCheck className="w-3.5 h-3.5 text-brand-600 mt-0.5 flex-shrink-0" />
                <span>No access? <span className="text-gray-500">Contact your university admin to get approved.</span></span>
              </div>
            </div>

            {/* Trust indicators */}
            <div className="mt-4 flex items-center justify-center gap-4 text-xs text-gray-600">
              <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3 text-brand-600" /> SSL Secured</span>
              <span className="flex items-center gap-1"><Star className="w-3 h-3 text-yellow-600" /> No ads, ever</span>
              <span className="flex items-center gap-1"><Wifi className="w-3 h-3 text-blue-600" /> Always online</span>
            </div>
          </div>

          {/* ── Right: Features ── */}
          <div className="flex-1 flex flex-col justify-center gap-4">
            <div className="mb-2">
              <h2 className="text-xl font-bold text-white mb-1">What you get</h2>
              <p className="text-gray-500 text-sm">Every format, every platform, zero friction.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {features.map(f => (
                <div key={f.label} className="glass p-4 rounded-xl hover:border-white/10 transition-colors group">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-9 h-9 bg-white/5 rounded-lg flex items-center justify-center group-hover:bg-white/8 transition-colors">
                      {f.icon}
                    </div>
                    <span className="text-sm font-semibold text-white">{f.label}</span>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed pl-12">{f.desc}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 glass p-4 rounded-xl">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">How it works</h3>
              <div className="flex flex-col gap-3">
                {[
                  { step: '1', text: 'Verify your student identity' },
                  { step: '2', text: 'Paste a video URL from any platform' },
                  { step: '3', text: 'Choose your format & quality' },
                  { step: '4', text: 'Download instantly to your device' },
                ].map(item => (
                  <div key={item.step} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-brand-400">{item.step}</span>
                    </div>
                    <span className="text-sm text-gray-400">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-white/5 px-4 sm:px-6 py-5">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-brand-500/20 rounded flex items-center justify-center">
              <Download className="w-3 h-3 text-brand-400" />
            </div>
            <span className="text-brand-600 font-semibold">UniStream Saver</span>
            <span>— University Students Video Downloader</span>
          </div>
          <div className="flex items-center gap-4">
            <span>For personal use only. Respect copyright laws.</span>
            <a href="#" className="text-gray-500 hover:text-gray-400 transition-colors">Privacy</a>
            <a href="#" className="text-gray-500 hover:text-gray-400 transition-colors">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  )
}