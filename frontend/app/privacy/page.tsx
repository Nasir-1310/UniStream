// frontend/app/privacy/page.tsx
// Privacy Policy. Static server component; describes what the app actually
// stores (see backend/storage.py) in plain language.

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronDown, ShieldCheck } from 'lucide-react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'What UniStream Saver stores (name, email, phone and download history), why, who can see it and how to have it deleted.',
}

const LAST_UPDATED = '6 October 2026'

const P = 'mt-3 text-[15px] leading-7 text-slate-300'
const UL = 'mt-3 space-y-2 pl-5 list-disc marker:text-slate-600 text-[15px] leading-7 text-slate-300'
const A = 'text-indigo-300 hover:text-indigo-200 underline underline-offset-2'
const B = 'text-white font-semibold'

const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: 'who',
    title: 'Who we are',
    body: (
      <p className={P}>
        UniStream Saver is a small, independently run service that lets approved members save YouTube, Facebook and
        Instagram videos for study and offline viewing. This policy explains what information we keep about you, why,
        and the choices you have. It applies together with our{' '}
        <Link href="/terms" className={A}>
          Terms of Use
        </Link>
        .
      </p>
    ),
  },
  {
    id: 'collect',
    title: 'Information we collect',
    body: (
      <>
        <ul className={UL}>
          <li>
            <span className={B}>Account details</span> you give when requesting access: full name, email address, mobile
            number and, if you add it, your institution or department.
          </li>
          <li>
            <span className={B}>Your password</span>, stored only as a one-way scrypt hash. Nobody, including the
            administrator, can see your actual password.
          </li>
          <li>
            <span className={B}>Account activity</span>: when your account was created and approved, when you last signed
            in and downloaded, how many downloads you&apos;ve made today and in total, and your daily limit.
          </li>
          <li>
            <span className={B}>Download history</span>: for each completed download, the video link, its title, the
            platform, the quality you chose, the file size and the time.
          </li>
        </ul>
        <p className={P}>
          We don&apos;t keep copies of the videos you download. Each file is deleted from our server as soon as it&apos;s
          delivered to you, or within a few minutes if it isn&apos;t collected. Links you only check (without
          downloading) aren&apos;t added to your history.
        </p>
        <p className={P}>
          Like any website, our servers see your IP address. We use it briefly in memory to block abuse such as repeated
          sign-in attempts; it isn&apos;t saved with your account. Our hosting provider may keep standard server logs for
          a short time for security and troubleshooting.
        </p>
      </>
    ),
  },
  {
    id: 'use',
    title: 'How we use it',
    body: (
      <ul className={UL}>
        <li>To review your access request and run your account, including signing in with your email or phone.</li>
        <li>To send account emails: your approval with a temporary password, and password-reset links you request.</li>
        <li>To apply the daily download limit fairly.</li>
        <li>To keep the service secure and to spot and stop misuse of the service or of other people&apos;s content.</li>
        <li>
          To understand overall usage, such as downloads per day or per platform, so we can keep the service running
          well.
        </li>
      </ul>
    ),
  },
  {
    id: 'emails',
    title: 'Emails we send',
    body: (
      <p className={P}>
        We only send emails about your account: your approval and temporary password, password-reset links, and
        important notices about the service. We don&apos;t send marketing or newsletters, and we don&apos;t sell or share
        your email address for anyone else&apos;s marketing.
      </p>
    ),
  },
  {
    id: 'sharing',
    title: 'Who can see your information',
    body: (
      <>
        <ul className={UL}>
          <li>
            <span className={B}>The administrator</span> can see your account details and download history to approve
            accounts, set limits and prevent abuse.
          </li>
          <li>
            <span className={B}>Service providers</span> that run the service for us: our application host, our database
            host and our email delivery provider. They process data only to provide their service to us.
          </li>
          <li>
            <span className={B}>Video platforms</span>: when you download, our server requests the video from YouTube,
            Facebook or Instagram. The platform sees our server, not your name, email or phone number.
          </li>
          <li>
            <span className={B}>Fonts</span>: the site loads its typefaces from Google Fonts, so Google receives your IP
            address when your browser fetches them.
          </li>
        </ul>
        <p className={P}>
          We never sell your personal information. We&apos;ll only share it with others if the law requires us to.
        </p>
      </>
    ),
  },
  {
    id: 'device',
    title: 'Stored on your device',
    body: (
      <p className={P}>
        To keep you signed in, your browser stores a sign-in token and a copy of your basic profile in local storage.
        Signing out removes them. We don&apos;t use advertising cookies, analytics trackers or third-party ads.
      </p>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    body: (
      <ul className={UL}>
        <li>Your account details are kept while your account exists.</li>
        <li>
          Download history is kept for record-keeping and is cleared from time to time by the administrator. You can ask
          for yours to be deleted sooner.
        </li>
        <li>
          When an account is deleted, its profile and password are removed. Any history entries that remain are no longer
          linked to an account and are cleared in the regular clean-ups.
        </li>
        <li>Sign-in sessions expire after 30 days; password-reset links expire after 60 minutes.</li>
      </ul>
    ),
  },
  {
    id: 'security',
    title: 'Security',
    body: (
      <p className={P}>
        Passwords are hashed with scrypt, sign-in attempts are rate-limited, and changing your password immediately signs
        out every other device. Data travels over encrypted (HTTPS) connections. No system is perfectly secure, so please
        use a password you don&apos;t use anywhere else and tell the administrator if you notice anything unusual.
      </p>
    ),
  },
  {
    id: 'choices',
    title: 'Your choices and rights',
    body: (
      <ul className={UL}>
        <li>
          See your details and today&apos;s usage on your{' '}
          <Link href="/account" className={A}>
            Account
          </Link>{' '}
          page, and change your password there at any time.
        </li>
        <li>Ask the administrator to correct your name, email or mobile number.</li>
        <li>Ask the administrator to delete your download history or your whole account.</li>
        <li>Stop using the service at any time.</li>
      </ul>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: (
      <p className={P}>
        UniStream Saver is meant for university students. If you&apos;re under 18, please use it only with a parent&apos;s
        or guardian&apos;s permission. We don&apos;t knowingly accept accounts from children under 13.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <p className={P}>
        We&apos;ll update this policy if what we collect or how we use it changes, for example if a paid plan is
        introduced. The date at the top shows the latest version, and we&apos;ll give notice in the app for important
        changes.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p className={P}>
        For any privacy question or request, reply to any email you&apos;ve received from UniStream Saver, or contact the
        administrator who approved your account.
      </p>
    ),
  },
]

export default function PrivacyPage() {
  return (
    <div className="min-h-svh flex flex-col bg-[#0d0f1a]">
      <Navbar />
      <main id="main" className="relative z-10 flex-1 px-4 sm:px-8 py-8 sm:py-14">
        <div className="max-w-5xl mx-auto lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
          <aside className="hidden lg:block">
            <nav aria-label="On this page" className="sticky top-24">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-3">On this page</p>
              <TableOfContents />
            </nav>
          </aside>

          <article className="min-w-0 max-w-3xl">
            <header>
              <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-400">
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                Legal
              </p>
              <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-white">Privacy Policy</h1>
              <p className="mt-2 text-sm text-slate-500">Last updated {LAST_UPDATED}</p>
            </header>

            <div className="mt-6 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-white">The short version</h2>
              <ul className="mt-2 space-y-1.5 pl-5 list-disc marker:text-emerald-400 text-[14px] leading-relaxed text-slate-300">
                <li>We store your name, email, mobile number and download history, and nothing more than we need.</li>
                <li>Your password is hashed. Nobody can read it, not even the administrator.</li>
                <li>We don&apos;t keep the videos, don&apos;t sell your data and don&apos;t send marketing emails.</li>
                <li>You can ask for your history or your whole account to be deleted.</li>
              </ul>
            </div>

            <details className="group lg:hidden mt-6 rounded-xl border border-white/[0.08] bg-white/[0.02]">
              <summary className="flex items-center justify-between gap-3 min-h-12 px-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden text-sm font-semibold text-slate-200">
                On this page
                <ChevronDown className="w-4 h-4 text-slate-500 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <nav aria-label="On this page" className="px-4 pb-3">
                <TableOfContents />
              </nav>
            </details>

            {SECTIONS.map((section, index) => (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="mt-10 scroll-mt-20">
                <h2 id={`${section.id}-title`} className="text-xl font-semibold text-white">
                  <span className="text-slate-500 mr-2 tabular-nums">{index + 1}.</span>
                  {section.title}
                </h2>
                {section.body}
              </section>
            ))}

            <p className="mt-12 pt-6 border-t border-white/[0.06] text-[13px] text-slate-500">
              See also our{' '}
              <Link href="/terms" className={A}>
                Terms of Use
              </Link>{' '}
              and the{' '}
              <Link href="/#faq" className={A}>
                FAQ
              </Link>
              .
            </p>
          </article>
        </div>
      </main>
      <Footer />
    </div>
  )
}

function TableOfContents() {
  return (
    <ol className="space-y-0.5 text-[13px]">
      {SECTIONS.map((section, index) => (
        <li key={section.id}>
          <a
            href={`#${section.id}`}
            className="flex gap-2 py-1.5 min-h-10 items-center rounded text-slate-400 hover:text-white transition-colors"
          >
            <span className="w-5 text-slate-600 tabular-nums">{index + 1}.</span>
            {section.title}
          </a>
        </li>
      ))}
    </ol>
  )
}
