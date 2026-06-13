'use client'
// frontend/app/page.tsx
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { checkAccess } from '@/lib/api'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import {
  Youtube, Facebook, Instagram, Music2,
  AlertCircle, CheckCircle2, Loader2,
  Lock, ArrowRight, Mail, Phone, X, ChevronRight,
} from 'lucide-react'

// ── Validation ────────────────────────────────────────────────────────────────
const EMAIL_RE =
  /^[a-zA-Z0-9][a-zA-Z0-9._%+\-]{0,63}@[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,24}$/
const BD_PHONE_RE = /^(?:\+?880)?01[3-9]\d{8}$/

type FieldType = 'email' | 'phone' | null
interface ValidationResult { type: FieldType; valid: boolean; hint: string }

function validate(raw: string): ValidationResult {
  const v = raw.trim()
  if (!v) return { type: null, valid: false, hint: '' }
  if (v.includes('@')) {
    if (EMAIL_RE.test(v)) return { type: 'email', valid: true, hint: '' }
    const parts = v.split('@')
    if (parts.length > 2)          return { type: 'email', valid: false, hint: 'Only one @ symbol allowed.' }
    if (!parts[0])                 return { type: 'email', valid: false, hint: 'Enter a username before @.' }
    if (!parts[1]?.includes('.'))  return { type: 'email', valid: false, hint: 'Missing domain — e.g. @gmail.com' }
    return { type: 'email', valid: false, hint: 'Invalid email — check the format.' }
  }
  if (/^[\d+]/.test(v)) {
    const digits = v.replace(/\D/g, '')
    if (BD_PHONE_RE.test(v))                          return { type: 'phone', valid: true, hint: '' }
    if (digits.length < 11)                           return { type: 'phone', valid: false, hint: 'Too short — needs 11 digits, e.g. 017XXXXXXXX.' }
    if (digits.length > 13)                           return { type: 'phone', valid: false, hint: 'Too long — check your number.' }
    if (!/^(?:\+?880)?01/.test(v))                    return { type: 'phone', valid: false, hint: 'Must start with 01, e.g. 017XXXXXXXX.' }
    const op = parseInt(digits.replace(/^(?:880)?0?1/, '').charAt(0))
    if (isNaN(op) || op < 3 || op > 9)               return { type: 'phone', valid: false, hint: 'Unrecognised operator — valid: 013–019.' }
    return { type: 'phone', valid: false, hint: 'Invalid number — use 01XXXXXXXXX.' }
  }
  return { type: null, valid: false, hint: 'Enter a valid email address or Bangladeshi phone number.' }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function HomePage() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [touched, setTouched]       = useState(false)
  const [loading, setLoading]       = useState(false)
  const [serverError, setServerError] = useState('')

  const validation = useMemo(() => validate(identifier), [identifier])
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
      setServerError('Unable to reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleChange(v: string) {
    setIdentifier(v)
    setServerError('')
  }

  const inputBorderClass =
    !touched || !identifier.trim()
      ? 'input-field'
      : validation.valid
      ? 'input-field input-valid'
      : 'input-field input-error'

  // ── Data ──────────────────────────────────────────────────────────────────
  const platforms = [
    { icon: <Youtube  className="w-3.5 h-3.5" />, name: 'YouTube',   color: 'text-red-400'  },
    { icon: <Facebook className="w-3.5 h-3.5" />, name: 'Facebook',  color: 'text-blue-400' },
    { icon: <Instagram className="w-3.5 h-3.5" />, name: 'Instagram', color: 'text-pink-400' },
    { icon: <Music2   className="w-3.5 h-3.5" />, name: 'TikTok',    color: 'text-cyan-400' },
  ]

  const stats = [
    { value: '12,400+', label: 'Active Students' },
    { value: '340+',    label: 'Universities'    },
    { value: '98K+',    label: 'Downloads / Day' },
    { value: '99.97%',  label: 'Uptime'          },
  ]

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-[#0d0f1a]">

      {/* Ambient glows — match image: top-center indigo blob, right-mid purple blob */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute top-[-120px] left-1/2 -translate-x-1/2 w-[900px] h-[480px] rounded-full"
          style={{ background: 'radial-gradient(ellipse, rgba(79,70,229,0.12) 0%, transparent 65%)' }} />
        <div className="absolute top-[10%] right-[-80px] w-[420px] h-[420px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.1) 0%, transparent 65%)' }} />
        <div className="absolute bottom-0 left-[-60px] w-[300px] h-[300px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(79,70,229,0.07) 0%, transparent 65%)' }} />
      </div>

      <Navbar />

      <main className="relative z-10 flex-1 flex flex-col">

        {/* ── Hero — two-column, matching image exactly ── */}
        <section className="flex flex-col lg:flex-row items-start lg:items-center
                            gap-10 lg:gap-8 max-w-7xl mx-auto w-full
                            px-5 sm:px-10 pt-14 pb-16 sm:pt-20 sm:pb-20">

          {/* ── LEFT: Copy + stats ── */}
          <div className="flex-1 min-w-20">

            {/* Eyebrow */}
            <div className="eyebrow-badge mb-7">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 flex-shrink-0" />
               Video Platform
            </div>

            {/* Headline — Space Grotesk, very large */}
            <h1
              className="text-[2.75rem] sm:text-[3.25rem] lg:text-[3.6rem]
                         font-extrabold text-white mb-5 max-w-xl"
              style={{ lineHeight: 1.06, letterSpacing: '-0.025em' }}
            >
              Your academic{' '}
              <span
                style={{
                  background: 'linear-gradient(90deg, #60a5fa 0%, #818cf8 50%, #a78bfa 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                video library
              </span>  unlocked.
             
            </h1>

            {/* Body */}
            <p className="text-slate-400 text-[15px] leading-relaxed max-w-[650px] mb-2">
              UniStreamSaver is a gated-access video management engine for university students.
              Paste any lecture URL — receive a full resolution matrix, metadata analysis, and instant download.
            </p>
            <p className="text-slate-500 text-[13px] leading-relaxed max-w-[440px] mb-8">
              <span className="text-indigo-400 font-medium">Free for verified university students</span> — expanding to everyone soon.
            </p>

            {/* Stats in bordered cards — matching image row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-7 max-w-[500px]">
              {stats.map(s => (
                <div key={s.label} className="stat-card">
                  <span className="font-bold text-white text-[1.125rem] leading-none"
                    style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    {s.value}
                  </span>
                  <span className="text-slate-500 text-[11px] leading-snug mt-1">{s.label}</span>
                </div>
              ))}
            </div>

            {/* Platform pills */}
            <div className="flex flex-wrap gap-2">
              {platforms.map(p => (
                <div key={p.name} className="platform-pill">
                  <span className={p.color}>{p.icon}</span>
                  {p.name}
                </div>
              ))}
            </div>
          </div>

          {/* ── RIGHT: Access Portal card ── */}
          <div className="w-full max-w-[360px] lg:max-w-[330px] flex-shrink-0 self-start lg:self-center ">
            <div className="portal-card p-10 pt-12">

              {/* Card header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 "
                  style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.2)' }}>
                  <Lock className="w-3.5 h-3.5 text-indigo-400" />
                </div>
                <div>
                  <p className="text-white font-semibold text-[13px] leading-none mb-1">Access Portal</p>
                  <p className="text-slate-500 text-[11px] leading-none">University credentials required</p>
                </div>
              </div>

              <form onSubmit={handleSubmit} noValidate className="space-y-4">

                {/* Email / phone field */}
                <div>
                  <label
                    htmlFor="identifier"
                    className="block text-[11px]  font-semibold tracking-widest uppercase mb-2 "
                    style={{ color: '#64748b', letterSpacing: '0.08em' }}
                  >
                    University Email
                  </label>

                  <div className="relative xl:pb-4 sm:pb-3 pb-2">
                    {/* Left icon */}
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none xl:pb-4 sm:pb-3 pb-2">
                      {validation.type === 'email'
                        ? <Mail  className="w-3.5 h-3.5 text-indigo-400 " />
                        : validation.type === 'phone'
                        ? <Phone className="w-3.5 h-3.5 text-indigo-400 " />
                        : <Mail  className="w-3.5 h-3.5 text-slate-600"  />
                      }
                    </div>

                    <input
                      id="identifier"
                      type="text"
                      inputMode={validation.type === 'phone' ? 'tel' : 'email'}
                      value={identifier}
                      onChange={e => handleChange(e.target.value)}
                      onBlur={() => setTouched(true)}
                      placeholder="student@university.edu"
                      className={`${inputBorderClass} pl-9 pr-16`}
                      style={{ paddingTop: '0.6875rem', paddingBottom: '0.6875rem' }}
                      disabled={loading}
                      autoComplete="email"
                      aria-describedby={showHint ? 'field-hint' : undefined}
                      aria-invalid={touched && !validation.valid && identifier.trim().length > 0}
                    />

                    {/* Right: clear + validity icon */}
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 xl:pb-4 sm:pb-3 pb-2">
                      {identifier.length > 0 && !loading && (
                        <button
                          type="button"
                          onClick={() => { setIdentifier(''); setTouched(false); setServerError('') }}
                          className="rounded-full text-slate-600 hover:text-slate-300 transition-colors p-0.5 "
                          aria-label="Clear"
                          tabIndex={-1}
                        >
                          <X className="w-3 h-3 " />
                        </button>
                      )}
                      {touched && identifier.trim().length > 0 && (
                        validation.valid
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 " />
                          : <AlertCircle  className="w-3.5 h-3.5 text-red-400 flex-shrink-0 "    />
                      )}
                    </div>
                  </div>

                  {/* Hint text */}
                  {showHint && (
                    <p id="field-hint" role="alert"
                      className="mt-1.5 text-[11px] text-red-400 flex items-start gap-1 fade-up ">
                      <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      {validation.hint}
                    </p>
                  )}
                  {touched && validation.valid && (
                    <p className="mt-1.5 text-[11px] text-emerald-400 flex items-center gap-1 fade-up">
                      <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                      {validation.type === 'email' ? 'Valid email address' : 'Valid Bangladeshi phone number'}
                    </p>
                  )}
                </div>

                {/* Server error */}
                {serverError && (
                  <div className="flex items-start gap-2 rounded-lg px-3.5 py-3 text-[12px] text-red-300 fade-up"
                    style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.15)' }}>
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>{serverError}</span>
                  </div>
                )}

                {/* Submit button */}
                <button
                  type="submit"
                  className="btn-primary w-full"
                  style={{ marginTop: '0.25rem' }}
                  disabled={loading || (touched && !validation.valid)}
                >
                  {loading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
                  ) : (
                    <>Verify & Enter <ArrowRight className="w-4 h-4" /></>
                  )}
                </button>
              </form>

              {/* Disclaimer */}
              <p className="mt-4 text-center text-[11px] text-slate-600 leading-relaxed">
                By accessing UniStreamSaver, you agree to the Academic Use Policy.
              </p>

              {/* Skip link */}
              <div className="mt-3 pt-3 border-t border-white/5 flex justify-center">
                <button className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-400 transition-colors">
                  <ChevronRight className="w-3 h-3" />
                  Skip verification — Preview the engine
                </button>
              </div>
            </div>
          </div>

        </section>

        {/* ── Below-the-fold: feature cards ── */}
        <section className="px-5 sm:px-8 pb-20 max-w-7xl mx-auto w-full">
          <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-slate-600 mb-6 text-center">
            Built for Academic Workflows
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                color: 'text-indigo-400',
                bgColor: 'rgba(99,102,241,0.1)',
                borderColor: 'rgba(99,102,241,0.15)',
                icon: (
                  <svg className="w-4.5 h-4.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.868V15.13a1 1 0 01-1.447.899L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                  </svg>
                ),
                title: '4K Resolution Engine',
                desc: 'Extract up to 4K UHD streams from any lecture recording platform with a single URL.',
              },
              {
                color: 'text-violet-400',
                bgColor: 'rgba(139,92,246,0.1)',
                borderColor: 'rgba(139,92,246,0.15)',
                icon: (
                  <svg className="w-4.5 h-4.5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                ),
                title: 'University-Gated Access',
                desc: 'Restricted to verified .edu addresses. Every session is authenticated and encrypted. Expanding to everyone soon.',
              },
              {
                color: 'text-emerald-400',
                bgColor: 'rgba(52,211,153,0.08)',
                borderColor: 'rgba(52,211,153,0.15)',
                icon: (
                  <svg className="w-4.5 h-4.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
                  </svg>
                ),
                title: 'Academic Use Only',
                desc: 'Built exclusively for students. Save lectures, seminars, and research videos directly to your device.',
              },
            ].map(card => (
              <div key={card.title} className="feature-card">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center mb-4"
                  style={{ background: card.bgColor, border: `1px solid ${card.borderColor}` }}
                >
                  {card.icon}
                </div>
                <h3 className="text-white font-semibold text-[13px] mb-1.5">{card.title}</h3>
                <p className="text-slate-500 text-[12px] leading-relaxed">{card.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}