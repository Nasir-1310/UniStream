// frontend/app/terms/page.tsx
// Terms of Use. Static server component: plain language first, short
// sections, a table of contents (sticky on desktop, collapsible on phones).

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronDown, FileText } from 'lucide-react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Terms of Use',
  description:
    'The rules for using UniStream Saver: personal and educational use, respecting copyright, daily download limits and account rules.',
}

const LAST_UPDATED = '6 October 2026'

const P = 'mt-3 text-[15px] leading-7 text-slate-300'
const UL = 'mt-3 space-y-2 pl-5 list-disc marker:text-slate-600 text-[15px] leading-7 text-slate-300'
const A = 'text-indigo-300 hover:text-indigo-200 underline underline-offset-2'

const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: 'service',
    title: 'About UniStream Saver',
    body: (
      <>
        <p className={P}>
          UniStream Saver (&ldquo;the service&rdquo;, &ldquo;we&rdquo;) is a small, independently run project that lets
          approved members save videos from YouTube, Facebook and Instagram for personal study and offline viewing. It
          started as a university project and is currently free to use.
        </p>
        <p className={P}>
          By requesting access or using the service, you agree to these terms and to our{' '}
          <Link href="/privacy" className={A}>
            Privacy Policy
          </Link>
          . If you don&apos;t agree, please don&apos;t use the service.
        </p>
      </>
    ),
  },
  {
    id: 'accounts',
    title: 'Your account',
    body: (
      <ul className={UL}>
        <li>
          Access is by request. An administrator reviews each request and may approve or decline it at their
          discretion.
        </li>
        <li>Give your real name and an email address and mobile number that belong to you, and keep them current.</li>
        <li>One account per person. Don&apos;t share your account or password with anyone.</li>
        <li>
          When you&apos;re approved we email you a temporary password. Please replace it with your own from the Account
          page as soon as you sign in.
        </li>
        <li>
          You&apos;re responsible for what happens under your account. If you think someone else has used it, change
          your password straight away (this signs out every other device) and tell the administrator.
        </li>
      </ul>
    ),
  },
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    body: (
      <>
        <p className={P}>Use UniStream Saver only for personal, non-commercial and educational purposes. You must not:</p>
        <ul className={UL}>
          <li>
            download videos you don&apos;t have the right to save, such as content whose owner forbids downloading, unless
            the law where you live allows it for private study;
          </li>
          <li>re-upload, share, sell, broadcast or otherwise distribute downloaded videos, or remove credits or watermarks;</li>
          <li>use the service for anything illegal, harmful, hateful or abusive;</li>
          <li>
            get around the daily limit or other protections, for example with several accounts, scripts, bots or
            automated requests;
          </li>
          <li>try to break, overload, probe or gain unauthorised access to the service or other people&apos;s accounts.</li>
        </ul>
        <p className={P}>
          You must also follow the terms of the platform the video comes from (YouTube, Facebook or Instagram).
        </p>
      </>
    ),
  },
  {
    id: 'copyright',
    title: 'Copyright and content',
    body: (
      <>
        <p className={P}>
          Videos belong to their creators and rights holders, not to us. UniStream Saver doesn&apos;t host, publish or
          endorse any video: it fetches the file you ask for and hands it to you. Downloaded files are removed from our
          server as soon as they&apos;re delivered, or within a few minutes if they aren&apos;t collected.
        </p>
        <p className={P}>
          You alone are responsible for how you use what you download. If you&apos;re a rights holder and believe the
          service is being misused, contact the administrator (see <a href="#contact" className={A}>Contact</a>) and
          we&apos;ll look into it promptly.
        </p>
      </>
    ),
  },
  {
    id: 'limits',
    title: 'Daily download limits',
    body: (
      <ul className={UL}>
        <li>
          Each account can complete <strong className="text-white">4 downloads per day</strong> by default. The count
          resets at midnight Bangladesh time (Asia/Dhaka).
        </li>
        <li>Only completed downloads count. Checking a link or a download that fails doesn&apos;t use your allowance.</li>
        <li>
          The administrator may set a different limit for individual accounts, change the default for everyone, or pause
          downloads to keep the service running smoothly.
        </li>
        <li>Your remaining downloads are always shown in the app.</li>
      </ul>
    ),
  },
  {
    id: 'paid-plans',
    title: 'Future paid plans',
    body: (
      <p className={P}>
        We may later offer an optional paid plan, for example with unlimited downloads. If we do, its price and terms
        will be published here before it launches. You will never be charged without clearly agreeing to it first, and
        using the free plan doesn&apos;t sign you up for anything.
      </p>
    ),
  },
  {
    id: 'availability',
    title: 'Availability and changes',
    body: (
      <p className={P}>
        We work hard to keep UniStream Saver running, but it&apos;s provided free and &ldquo;as is&rdquo;. It may be slow,
        unavailable or changed at any time, and some videos can&apos;t be downloaded because of how a platform delivers
        them. Platforms change often, so a feature that works today may stop working tomorrow. We may add, change or
        remove features, including supported platforms.
      </p>
    ),
  },
  {
    id: 'suspension',
    title: 'Suspension and closing accounts',
    body: (
      <>
        <p className={P}>
          The administrator may limit, block or delete an account that breaks these terms, puts the service or other
          members at risk, or stays inactive for a long time. Where it&apos;s reasonable, we&apos;ll tell you why.
        </p>
        <p className={P}>
          You can stop using the service at any time and ask the administrator to delete your account (see the{' '}
          <Link href="/privacy#choices" className={A}>
            Privacy Policy
          </Link>
          ).
        </p>
      </>
    ),
  },
  {
    id: 'liability',
    title: 'Disclaimer and liability',
    body: (
      <p className={P}>
        To the extent the law allows, UniStream Saver and the people who run it are not liable for any indirect or
        consequential loss, lost data, or claims arising from how you use the service or the videos you download. Nothing
        in these terms limits rights you have under the law that can&apos;t be limited.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <p className={P}>
        We may update these terms as the service grows. The date at the top shows when they last changed. For important
        changes we&apos;ll give notice in the app. If you keep using the service after a change, you accept the updated
        terms. These terms are governed by the laws of Bangladesh.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p className={P}>
        Questions about these terms? Reply to any email you&apos;ve received from UniStream Saver, or contact the
        administrator who approved your account.
      </p>
    ),
  },
]

export default function TermsPage() {
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
                <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                Legal
              </p>
              <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-white">Terms of Use</h1>
              <p className="mt-2 text-sm text-slate-500">Last updated {LAST_UPDATED}</p>
            </header>

            <div className="mt-6 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.06] p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-white">The short version</h2>
              <ul className="mt-2 space-y-1.5 pl-5 list-disc marker:text-indigo-400 text-[14px] leading-relaxed text-slate-300">
                <li>Use UniStream Saver for your own study and offline viewing.</li>
                <li>Only save videos you&apos;re allowed to, and never re-upload, share or sell them.</li>
                <li>One account per person. Keep your password to yourself.</li>
                <li>You get 4 downloads a day by default. Accounts that break the rules can be blocked.</li>
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
              <Link href="/privacy" className={A}>
                Privacy Policy
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
