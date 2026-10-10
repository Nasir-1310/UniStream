// frontend/app/terms/page.tsx
// Terms of Use (Bangla). Static server component: plain language first, short
// sections, a table of contents (sticky on desktop, collapsible on phones).

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronDown, FileText } from 'lucide-react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'ব্যবহারের শর্তাবলি',
  description:
    'UniStream Saver ব্যবহারের নিয়ম: ব্যক্তিগত ও পড়াশোনার কাজে ব্যবহার, কপিরাইট মেনে চলা, ডাউনলোডের সীমা আর অ্যাকাউন্টের নিয়ম।',
}

const LAST_UPDATED = '10 অক্টোবর 2026'

const P = 'mt-3 text-[15px] leading-7 text-slate-300'
const UL = 'mt-3 space-y-2 pl-5 list-disc marker:text-slate-600 text-[15px] leading-7 text-slate-300'
const A = 'text-indigo-300 hover:text-indigo-200 underline underline-offset-2'

const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: 'service',
    title: 'UniStream Saver সম্পর্কে',
    body: (
      <>
        <p className={P}>
          UniStream Saver (&ldquo;সার্ভিস&rdquo;, &ldquo;আমরা&rdquo;) একটি স্বাধীনভাবে পরিচালিত সার্ভিস, যা অনুমোদিত
          সদস্যদের ব্যক্তিগত পড়াশোনা আর অফলাইনে দেখার জন্য YouTube, Facebook ও Instagram থেকে ভিডিও সেভ করতে দেয়।
          অনুমোদিত শিক্ষার্থীদের জন্য এটি ফ্রি, আর অ্যাকাউন্ট অনুযায়ী প্রতিদিন আনলিমিটেড ডাউনলোড।
        </p>
        <p className={P}>
          অ্যাক্সেসের অনুরোধ করলে বা সার্ভিস ব্যবহার করলে আপনি এই শর্তাবলি এবং আমাদের{' '}
          <Link href="/privacy" className={A}>
            প্রাইভেসি পলিসি
          </Link>{' '}
          মেনে নিচ্ছেন। রাজি না থাকলে সার্ভিসটি ব্যবহার করবেন না।
        </p>
      </>
    ),
  },
  {
    id: 'accounts',
    title: 'আপনার অ্যাকাউন্ট',
    body: (
      <ul className={UL}>
        <li>অ্যাক্সেস পাওয়া যায় অনুরোধের মাধ্যমে। অ্যাডমিন প্রতিটি অনুরোধ দেখে নিজের বিবেচনায় অনুমোদন দেন বা ফিরিয়ে দেন।</li>
        <li>আপনার আসল নাম আর নিজের ইমেইল ও মোবাইল নম্বর দিন, এবং তথ্যগুলো হালনাগাদ রাখুন।</li>
        <li>প্রতিজনের একটি অ্যাকাউন্ট। অ্যাকাউন্ট বা পাসওয়ার্ড কারও সাথে শেয়ার করবেন না।</li>
        <li>
          অনুমোদন হলে ইমেইলে একটি অস্থায়ী পাসওয়ার্ড পাঠানো হয়। সাইন ইন করার পরপরই অ্যাকাউন্ট পেজ থেকে নিজের পাসওয়ার্ড
          সেট করে নিন।
        </li>
        <li>
          আপনার অ্যাকাউন্ট থেকে যা হয় তার দায় আপনার। অন্য কেউ ব্যবহার করেছে মনে হলে সঙ্গে সঙ্গে পাসওয়ার্ড বদলান (এতে অন্য
          সব ডিভাইস থেকে সাইন আউট হয়ে যায়) আর অ্যাডমিনকে জানান।
        </li>
      </ul>
    ),
  },
  {
    id: 'acceptable-use',
    title: 'গ্রহণযোগ্য ব্যবহার',
    body: (
      <>
        <p className={P}>UniStream Saver শুধু ব্যক্তিগত, অ-বাণিজ্যিক ও পড়াশোনার কাজে ব্যবহার করুন। যা করা যাবে না:</p>
        <ul className={UL}>
          <li>
            যে ভিডিও সেভ করার অধিকার আপনার নেই, যেমন মালিক ডাউনলোড নিষেধ করেছেন এমন কনটেন্ট, তা ডাউনলোড করা (আপনার দেশের
            আইন ব্যক্তিগত পড়াশোনার জন্য অনুমতি না দিলে);
          </li>
          <li>ডাউনলোড করা ভিডিও আবার আপলোড, শেয়ার, বিক্রি বা প্রচার করা, কিংবা ক্রেডিট বা ওয়াটারমার্ক মুছে ফেলা;</li>
          <li>অবৈধ, ক্ষতিকর, ঘৃণাসূচক বা অপমানজনক কোনো কাজে সার্ভিস ব্যবহার করা;</li>
          <li>একাধিক অ্যাকাউন্ট, স্ক্রিপ্ট, বট বা স্বয়ংক্রিয় অনুরোধ দিয়ে দৈনিক সীমা বা অন্য সুরক্ষা এড়িয়ে যাওয়া;</li>
          <li>সার্ভিস ভাঙার, অতিরিক্ত চাপ দেওয়ার, খোঁজাখুঁজির বা অন্যের অ্যাকাউন্টে অননুমোদিত প্রবেশের চেষ্টা করা।</li>
        </ul>
        <p className={P}>যে প্ল্যাটফর্মের ভিডিও (YouTube, Facebook বা Instagram), তার নিয়মও আপনাকে মেনে চলতে হবে।</p>
      </>
    ),
  },
  {
    id: 'copyright',
    title: 'কপিরাইট ও কনটেন্ট',
    body: (
      <>
        <p className={P}>
          ভিডিওগুলোর মালিক তাদের নির্মাতা ও স্বত্বাধিকারীরা, আমরা নই। UniStream Saver কোনো ভিডিও হোস্ট, প্রকাশ বা সমর্থন
          করে না: আপনি যে ফাইল চান তা এনে আপনাকে দেয়। ডাউনলোড করা ফাইল আপনাকে দেওয়ার সঙ্গে সঙ্গে, আর না নিলে কয়েক
          মিনিটের মধ্যে আমাদের সার্ভার থেকে মুছে ফেলা হয়।
        </p>
        <p className={P}>
          ডাউনলোড করা ভিডিও কীভাবে ব্যবহার করবেন তার সম্পূর্ণ দায় আপনার। আপনি স্বত্বাধিকারী হলে এবং সার্ভিসের অপব্যবহার
          হচ্ছে মনে করলে অ্যাডমিনের সাথে যোগাযোগ করুন (দেখুন{' '}
          <a href="#contact" className={A}>
            যোগাযোগ
          </a>
          ), আমরা দ্রুত বিষয়টি দেখব।
        </p>
      </>
    ),
  },
  {
    id: 'limits',
    title: 'দৈনিক ডাউনলোড সীমা',
    body: (
      <ul className={UL}>
        <li>
          অ্যাকাউন্ট অনুযায়ী প্রতিদিন <strong className="text-white">আনলিমিটেড ডাউনলোড</strong>। অ্যাডমিন কোনো অ্যাকাউন্টে
          দৈনিক সীমা দিতে পারেন; সেই হিসাব বাংলাদেশ সময় রাত ১২টায় নতুন করে শুরু হয়।
        </li>
        <li>শুধু সম্পূর্ণ ডাউনলোড গোনা হয়। লিংক দেখা, বাতিল করা বা ব্যর্থ ডাউনলোড আপনার সীমা থেকে কাটা হয় না।</li>
        <li>
          সার্ভিস ঠিকমতো চালু রাখতে অ্যাডমিন আলাদা অ্যাকাউন্টের জন্য আলাদা সীমা দিতে, সবার জন্য সীমা বদলাতে বা ডাউনলোড
          সাময়িকভাবে বন্ধ রাখতে পারেন।
        </li>
        <li>আজ কতগুলো ডাউনলোড বাকি, তা সবসময় অ্যাপে দেখা যায়।</li>
      </ul>
    ),
  },
  {
    id: 'paid-plans',
    title: 'ভবিষ্যতের পেইড প্ল্যান',
    body: (
      <p className={P}>
        কখনো পেইড প্ল্যান চালু হলে তা হবে ঐচ্ছিক, আর চালুর আগে এর দাম ও শর্ত এখানে প্রকাশ করা হবে। আপনার স্পষ্ট সম্মতি
        ছাড়া কখনো কোনো টাকা নেওয়া হবে না, আর ফ্রি প্ল্যান ব্যবহার করলে আপনি কোনো কিছুতে সাবস্ক্রাইব হয়ে যান না।
      </p>
    ),
  },
  {
    id: 'availability',
    title: 'সার্ভিসের প্রাপ্যতা ও পরিবর্তন',
    body: (
      <p className={P}>
        UniStream Saver চালু রাখতে আমরা চেষ্টা করি, তবে এটি ফ্রি আর &ldquo;যেমন আছে তেমন&rdquo; ভিত্তিতে দেওয়া হয়। যেকোনো
        সময় এটি ধীর বা বন্ধ হতে পারে, বা বদলাতে পারে, আর প্ল্যাটফর্ম যেভাবে ভিডিও দেয় তার কারণে কিছু ভিডিও ডাউনলোড করা
        যায় না। প্ল্যাটফর্মগুলো প্রায়ই বদলায়, তাই আজ যা কাজ করছে তা কাল বন্ধ হয়ে যেতে পারে। আমরা ফিচার (সাপোর্ট করা
        প্ল্যাটফর্মসহ) যোগ করতে, বদলাতে বা সরিয়ে দিতে পারি।
      </p>
    ),
  },
  {
    id: 'suspension',
    title: 'অ্যাকাউন্ট স্থগিত ও বন্ধ করা',
    body: (
      <>
        <p className={P}>
          যে অ্যাকাউন্ট এই শর্তাবলি ভাঙে, সার্ভিস বা অন্য সদস্যদের ঝুঁকিতে ফেলে, বা দীর্ঘদিন নিষ্ক্রিয় থাকে, অ্যাডমিন তা
          সীমিত, ব্লক বা মুছে ফেলতে পারেন। যুক্তিসঙ্গত হলে আমরা কারণ জানাব।
        </p>
        <p className={P}>
          আপনি যেকোনো সময় সার্ভিস ব্যবহার বন্ধ করতে এবং অ্যাডমিনকে অ্যাকাউন্ট মুছে ফেলতে বলতে পারেন (দেখুন{' '}
          <Link href="/privacy#choices" className={A}>
            প্রাইভেসি পলিসি
          </Link>
          )।
        </p>
      </>
    ),
  },
  {
    id: 'liability',
    title: 'দায় অস্বীকার ও দায়বদ্ধতা',
    body: (
      <p className={P}>
        আইন যতটুকু অনুমতি দেয়, সার্ভিস ব্যবহার বা ডাউনলোড করা ভিডিও থেকে সৃষ্ট কোনো পরোক্ষ ক্ষতি, তথ্য হারানো বা দাবির জন্য
        UniStream Saver ও এর পরিচালকেরা দায়ী নন। আইন অনুযায়ী যেসব অধিকার সীমিত করা যায় না, এই শর্তাবলি সেগুলো সীমিত করে
        না।
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'শর্তাবলির পরিবর্তন',
    body: (
      <p className={P}>
        সার্ভিস বড় হওয়ার সাথে সাথে আমরা এই শর্তাবলি হালনাগাদ করতে পারি। শেষ কবে বদলানো হয়েছে তা ওপরের তারিখে দেখা যায়।
        গুরুত্বপূর্ণ পরিবর্তন হলে অ্যাপে জানানো হবে। পরিবর্তনের পরও সার্ভিস ব্যবহার করলে আপনি হালনাগাদ শর্তাবলি মেনে
        নিচ্ছেন। এই শর্তাবলি বাংলাদেশের আইন অনুযায়ী পরিচালিত।
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'যোগাযোগ',
    body: (
      <p className={P}>
        এই শর্তাবলি নিয়ে প্রশ্ন আছে? UniStream Saver থেকে পাওয়া যেকোনো ইমেইলের উত্তর দিন, অথবা যে অ্যাডমিন আপনার অ্যাকাউন্ট
        অনুমোদন করেছেন তার সাথে যোগাযোগ করুন।
      </p>
    ),
  },
]

export default function TermsPage() {
  return (
    <div className="min-h-svh flex flex-col page-bg">
      <Navbar />
      <main id="main" className="relative z-10 flex-1 px-4 sm:px-8 py-8 sm:py-14">
        <div className="max-w-5xl mx-auto lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
          <aside className="hidden lg:block">
            <nav aria-label="এই পেজে" className="sticky top-24">
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-3">এই পেজে</p>
              <TableOfContents />
            </nav>
          </aside>

          <article className="min-w-0 max-w-3xl">
            <header>
              <p className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-sky-400">
                <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                আইনি তথ্য
              </p>
              <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-white">ব্যবহারের শর্তাবলি</h1>
              <p className="mt-2 text-sm text-slate-500">সর্বশেষ হালনাগাদ: {LAST_UPDATED}</p>
            </header>

            <div className="mt-6 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.06] p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-white">সংক্ষেপে</h2>
              <ul className="mt-2 space-y-1.5 pl-5 list-disc marker:text-indigo-400 text-[14px] leading-relaxed text-slate-300">
                <li>UniStream Saver ব্যবহার করুন নিজের পড়াশোনা আর অফলাইনে দেখার জন্য।</li>
                <li>শুধু অনুমতি আছে এমন ভিডিও সেভ করুন, আর কখনো আবার আপলোড, শেয়ার বা বিক্রি করবেন না।</li>
                <li>প্রতিজনের একটি অ্যাকাউন্ট। পাসওয়ার্ড নিজের কাছে রাখুন।</li>
                <li>অ্যাকাউন্ট অনুযায়ী প্রতিদিন আনলিমিটেড ডাউনলোড। নিয়ম ভাঙলে অ্যাকাউন্ট ব্লক করা হতে পারে।</li>
              </ul>
            </div>

            <details className="group lg:hidden mt-6 rounded-xl border border-white/[0.08] bg-white/[0.02]">
              <summary className="flex items-center justify-between gap-3 min-h-12 px-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden text-sm font-semibold text-slate-200">
                এই পেজে
                <ChevronDown className="w-4 h-4 text-slate-500 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <nav aria-label="এই পেজে" className="px-4 pb-3">
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
              আরও দেখুন:{' '}
              <Link href="/privacy" className={A}>
                প্রাইভেসি পলিসি
              </Link>{' '}
              ও{' '}
              <Link href="/#faq" className={A}>
                প্রশ্নোত্তর
              </Link>
              ।
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
