// frontend/app/privacy/page.tsx
// Privacy Policy (Bangla). Static server component; describes what the app
// actually stores (see backend/storage.py) in plain language.

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronDown, ShieldCheck } from 'lucide-react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'প্রাইভেসি পলিসি',
  description:
    'UniStream Saver কী তথ্য রাখে (নাম, ইমেইল, মোবাইল নম্বর ও ডাউনলোড হিস্টোরি), কেন রাখে, কারা দেখতে পারে, আর কীভাবে মুছে ফেলতে বলবেন।',
}

const LAST_UPDATED = '10 অক্টোবর 2026'

const P = 'mt-3 text-[15px] leading-7 text-slate-300'
const UL = 'mt-3 space-y-2 pl-5 list-disc marker:text-slate-600 text-[15px] leading-7 text-slate-300'
const A = 'text-indigo-300 hover:text-indigo-200 underline underline-offset-2'
const B = 'text-white font-semibold'

const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: 'who',
    title: 'আমরা কারা',
    body: (
      <p className={P}>
        UniStream Saver একটি স্বাধীনভাবে পরিচালিত সার্ভিস, যা অনুমোদিত সদস্যদের পড়াশোনা আর অফলাইনে দেখার জন্য YouTube,
        Facebook ও Instagram ভিডিও সেভ করতে দেয়। আপনার সম্পর্কে আমরা কী তথ্য রাখি, কেন রাখি, আর আপনার কী কী সুযোগ আছে —
        এই পলিসিতে তা বলা হয়েছে। এটি আমাদের{' '}
        <Link href="/terms" className={A}>
          ব্যবহারের শর্তাবলি
        </Link>
        -র সাথে একসাথে প্রযোজ্য।
      </p>
    ),
  },
  {
    id: 'collect',
    title: 'যে তথ্য আমরা রাখি',
    body: (
      <>
        <ul className={UL}>
          <li>
            <span className={B}>অ্যাকাউন্টের তথ্য</span> যা অ্যাক্সেসের অনুরোধের সময় দেন: পুরো নাম, ইমেইল, মোবাইল নম্বর,
            আর দিলে আপনার প্রতিষ্ঠান বা বিভাগ।
          </li>
          <li>
            <span className={B}>আপনার পাসওয়ার্ড</span>, শুধু একমুখী scrypt hash হিসেবে রাখা হয়। অ্যাডমিনসহ কেউই আপনার আসল
            পাসওয়ার্ড দেখতে পারেন না।
          </li>
          <li>
            <span className={B}>অ্যাকাউন্টের কার্যকলাপ</span>: অ্যাকাউন্ট কবে তৈরি ও অনুমোদিত হয়েছে, শেষ কবে সাইন ইন ও
            ডাউনলোড করেছেন, আজ আর মোট কতগুলো ডাউনলোড করেছেন, আর আপনার দৈনিক সীমা।
          </li>
          <li>
            <span className={B}>ডাউনলোড হিস্টোরি</span>: প্রতিটি সম্পূর্ণ ডাউনলোডের ভিডিও লিংক, শিরোনাম, প্ল্যাটফর্ম, বেছে
            নেওয়া কোয়ালিটি, ফাইলের সাইজ ও সময়।
          </li>
          <li>
            <span className={B}>আপনার পাঠানো মতামত ও সমস্যার বিবরণ</span>: আপনার লেখা বার্তা, দেওয়া লিংক, আর ব্যর্থ ডাউনলোড
            থেকে জানালে তার কোয়ালিটি ও এরর মেসেজ।
          </li>
        </ul>
        <p className={P}>
          আপনার ডাউনলোড করা ভিডিওর কোনো কপি আমরা রাখি না। প্রতিটি ফাইল আপনাকে দেওয়ার সঙ্গে সঙ্গে, আর না নিলে কয়েক মিনিটের
          মধ্যে, আমাদের সার্ভার থেকে মুছে ফেলা হয়। শুধু দেখা লিংক (ডাউনলোড না করলে) হিস্টোরিতে যোগ হয় না।
        </p>
        <p className={P}>
          যেকোনো ওয়েবসাইটের মতো আমাদের সার্ভারও আপনার IP ঠিকানা দেখে। বারবার সাইন ইনের চেষ্টার মতো অপব্যবহার ঠেকাতে আমরা এটি
          অল্প সময়ের জন্য মেমোরিতে ব্যবহার করি; এটি আপনার অ্যাকাউন্টের সাথে সংরক্ষণ করা হয় না। নিরাপত্তা ও সমস্যা সমাধানের জন্য
          আমাদের হোস্টিং প্রোভাইডার স্বল্প সময়ের জন্য সাধারণ সার্ভার লগ রাখতে পারে।
        </p>
      </>
    ),
  },
  {
    id: 'use',
    title: 'তথ্য যেভাবে ব্যবহার করি',
    body: (
      <ul className={UL}>
        <li>আপনার অ্যাক্সেসের অনুরোধ যাচাই আর অ্যাকাউন্ট চালাতে, ইমেইল বা মোবাইল নম্বর দিয়ে সাইন ইনসহ।</li>
        <li>অ্যাকাউন্টের ইমেইল পাঠাতে: অস্থায়ী পাসওয়ার্ডসহ অনুমোদনের ইমেইল, আর আপনার চাওয়া পাসওয়ার্ড রিসেট লিংক।</li>
        <li>দৈনিক ডাউনলোড সীমা ন্যায্যভাবে প্রয়োগ করতে।</li>
        <li>সার্ভিস নিরাপদ রাখতে, আর সার্ভিস বা অন্যের কনটেন্টের অপব্যবহার ধরতে ও ঠেকাতে।</li>
        <li>সার্ভিস ভালোভাবে চালু রাখতে সামগ্রিক ব্যবহার বুঝতে, যেমন প্রতিদিন বা প্রতি প্ল্যাটফর্মে কতগুলো ডাউনলোড।</li>
        <li>আপনার জানানো সমস্যা ঠিক করতে আর পরের সংস্করণে সার্ভিস আরও ভালো করতে।</li>
      </ul>
    ),
  },
  {
    id: 'emails',
    title: 'যে ইমেইল পাঠাই',
    body: (
      <p className={P}>
        আমরা শুধু আপনার অ্যাকাউন্ট সংক্রান্ত ইমেইল পাঠাই: অনুমোদন ও অস্থায়ী পাসওয়ার্ড, পাসওয়ার্ড রিসেট লিংক, আর সার্ভিস নিয়ে
        গুরুত্বপূর্ণ নোটিশ। কোনো মার্কেটিং ইমেইল বা নিউজলেটার পাঠাই না, আর অন্য কারও মার্কেটিংয়ের জন্য আপনার ইমেইল বিক্রি বা
        শেয়ার করি না।
      </p>
    ),
  },
  {
    id: 'sharing',
    title: 'কারা আপনার তথ্য দেখতে পারেন',
    body: (
      <>
        <ul className={UL}>
          <li>
            <span className={B}>অ্যাডমিন</span> অ্যাকাউন্ট অনুমোদন, সীমা নির্ধারণ আর অপব্যবহার ঠেকাতে আপনার অ্যাকাউন্টের তথ্য,
            ডাউনলোড হিস্টোরি আর পাঠানো মতামত দেখতে পারেন।
          </li>
          <li>
            <span className={B}>সার্ভিস প্রোভাইডার</span> যারা আমাদের হয়ে সার্ভিস চালায়: অ্যাপ্লিকেশন হোস্ট, ডাটাবেস হোস্ট আর
            ইমেইল পাঠানোর প্রোভাইডার। তারা শুধু আমাদের সেবা দিতেই তথ্য ব্যবহার করে।
          </li>
          <li>
            <span className={B}>ভিডিও প্ল্যাটফর্ম</span>: ডাউনলোডের সময় আমাদের সার্ভার YouTube, Facebook বা Instagram থেকে
            ভিডিও চায়। প্ল্যাটফর্মটি আমাদের সার্ভারকে দেখে, আপনার নাম, ইমেইল বা মোবাইল নম্বর নয়।
          </li>
          <li>
            <span className={B}>ফন্ট</span>: সাইটের ফন্ট Google Fonts থেকে লোড হয়, তাই আপনার ব্রাউজার ফন্ট আনার সময় Google
            আপনার IP ঠিকানা পায়।
          </li>
        </ul>
        <p className={P}>আমরা কখনো আপনার ব্যক্তিগত তথ্য বিক্রি করি না। আইন বাধ্য করলেই শুধু অন্যদের সাথে শেয়ার করা হবে।</p>
      </>
    ),
  },
  {
    id: 'device',
    title: 'আপনার ডিভাইসে যা রাখা হয়',
    body: (
      <p className={P}>
        আপনাকে সাইন ইন অবস্থায় রাখতে আপনার ব্রাউজার একটি সাইন ইন টোকেন আর আপনার প্রোফাইলের সাধারণ তথ্যের কপি local storage-এ
        রাখে। সাইন আউট করলে এগুলো মুছে যায়। আমরা কোনো বিজ্ঞাপনী কুকি, অ্যানালিটিক্স ট্র্যাকার বা থার্ড-পার্টি বিজ্ঞাপন ব্যবহার
        করি না।
      </p>
    ),
  },
  {
    id: 'retention',
    title: 'কতদিন রাখি',
    body: (
      <ul className={UL}>
        <li>অ্যাকাউন্ট যতদিন থাকে, অ্যাকাউন্টের তথ্যও ততদিন রাখা হয়।</li>
        <li>রেকর্ড রাখার জন্য ডাউনলোড হিস্টোরি রাখা হয়, আর অ্যাডমিন মাঝে মাঝে তা মুছে ফেলেন। আপনি আগেই মুছে ফেলতে বলতে পারেন।</li>
        <li>
          অ্যাকাউন্ট মুছে ফেললে প্রোফাইল আর পাসওয়ার্ড সরিয়ে ফেলা হয়। থেকে যাওয়া হিস্টোরি আর কোনো অ্যাকাউন্টের সাথে যুক্ত থাকে
          না, আর নিয়মিত পরিষ্কারের সময় মুছে যায়।
        </li>
        <li>মতামত ও সমস্যার বিবরণ সমাধান হওয়া পর্যন্ত রাখা হয়, তারপর অ্যাডমিন মুছে ফেলতে পারেন।</li>
        <li>সাইন ইন সেশনের মেয়াদ ৩০ দিন; পাসওয়ার্ড রিসেট লিংকের মেয়াদ ৬০ মিনিট।</li>
      </ul>
    ),
  },
  {
    id: 'security',
    title: 'নিরাপত্তা',
    body: (
      <p className={P}>
        পাসওয়ার্ড scrypt দিয়ে hash করা হয়, সাইন ইনের চেষ্টার সংখ্যা সীমিত রাখা হয়, আর পাসওয়ার্ড বদলালে সঙ্গে সঙ্গে অন্য সব
        ডিভাইস থেকে সাইন আউট হয়ে যায়। আপনার সাইন ইন টোকেন কখনো ওয়েব ঠিকানায় রাখা হয় না: প্রতিটি ডাউনলোড শুরু হয় স্বল্পমেয়াদি,
        একবার ব্যবহারযোগ্য একটি ডাউনলোড লিংক দিয়ে। তথ্য এনক্রিপ্টেড (HTTPS) সংযোগে আদান-প্রদান হয়। কোনো সিস্টেমই শতভাগ নিরাপদ
        নয়, তাই অন্য কোথাও ব্যবহার করেন না এমন পাসওয়ার্ড দিন, আর অস্বাভাবিক কিছু দেখলে অ্যাডমিনকে জানান।
      </p>
    ),
  },
  {
    id: 'choices',
    title: 'আপনার সুযোগ ও অধিকার',
    body: (
      <ul className={UL}>
        <li>
          আপনার{' '}
          <Link href="/account" className={A}>
            অ্যাকাউন্ট
          </Link>{' '}
          পেজে নিজের তথ্য আর আজকের ব্যবহার দেখুন, আর যেকোনো সময় সেখান থেকে পাসওয়ার্ড বদলান।
        </li>
        <li>নাম, ইমেইল বা মোবাইল নম্বর ঠিক করতে অ্যাডমিনকে বলুন।</li>
        <li>ডাউনলোড হিস্টোরি বা পুরো অ্যাকাউন্ট মুছে ফেলতে অ্যাডমিনকে বলুন।</li>
        <li>যেকোনো সময় সার্ভিস ব্যবহার বন্ধ করুন।</li>
      </ul>
    ),
  },
  {
    id: 'children',
    title: 'শিশু',
    body: (
      <p className={P}>
        UniStream Saver শিক্ষার্থীদের জন্য। আপনার বয়স ১৮-র কম হলে শুধু বাবা-মা বা অভিভাবকের অনুমতি নিয়ে ব্যবহার করুন। ১৩
        বছরের কম বয়সী শিশুদের অ্যাকাউন্ট আমরা জেনেশুনে গ্রহণ করি না।
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'এই পলিসির পরিবর্তন',
    body: (
      <p className={P}>
        আমরা কী তথ্য রাখি বা কীভাবে ব্যবহার করি তা বদলালে এই পলিসি হালনাগাদ করা হবে। ওপরের তারিখে সর্বশেষ সংস্করণ দেখা যায়, আর
        গুরুত্বপূর্ণ পরিবর্তন হলে অ্যাপে জানানো হবে।
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'যোগাযোগ',
    body: (
      <p className={P}>
        প্রাইভেসি নিয়ে কোনো প্রশ্ন বা অনুরোধ থাকলে UniStream Saver থেকে পাওয়া যেকোনো ইমেইলের উত্তর দিন, অথবা যে অ্যাডমিন আপনার
        অ্যাকাউন্ট অনুমোদন করেছেন তার সাথে যোগাযোগ করুন।
      </p>
    ),
  },
]

export default function PrivacyPage() {
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
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                আইনি তথ্য
              </p>
              <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-white">প্রাইভেসি পলিসি</h1>
              <p className="mt-2 text-sm text-slate-500">সর্বশেষ হালনাগাদ: {LAST_UPDATED}</p>
            </header>

            <div className="mt-6 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-white">সংক্ষেপে</h2>
              <ul className="mt-2 space-y-1.5 pl-5 list-disc marker:text-emerald-400 text-[14px] leading-relaxed text-slate-300">
                <li>আপনার নাম, ইমেইল, মোবাইল নম্বর আর ডাউনলোড হিস্টোরি রাখি — প্রয়োজনের বেশি কিছু নয়।</li>
                <li>আপনার পাসওয়ার্ড hash করা থাকে। কেউ পড়তে পারে না, অ্যাডমিনও না।</li>
                <li>ভিডিও রাখি না, আপনার তথ্য বিক্রি করি না, মার্কেটিং ইমেইলও পাঠাই না।</li>
                <li>হিস্টোরি বা পুরো অ্যাকাউন্ট মুছে ফেলতে বলতে পারেন।</li>
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
              <Link href="/terms" className={A}>
                ব্যবহারের শর্তাবলি
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
