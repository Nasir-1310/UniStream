// lib/tutorials.ts
//
// The "how to use" guides behind the video buttons (components/TutorialDialog).
// Each guide shows its screen recording, when there is one, above the steps.
// To add a recording: put the MP4 in public/tutorials/ and set `video`, e.g.
//   video: { src: '/tutorials/sign-in.mp4', poster: '/tutorials/sign-in.jpg' }

export interface TutorialVideo {
  /** MP4 (H.264) path under /public, or a full URL. */
  src: string
  /** Still shown before playing (optional). */
  poster?: string
}

export interface Tutorial {
  title: string
  description: string
  video?: TutorialVideo
  steps: { title: string; text: string }[]
}

/** Home page: from creating an account to the first saved video. */
export const SIGN_IN_TUTORIAL: Tutorial = {
  title: 'সাইন ইন করে ভিডিও ডাউনলোড',
  description: 'অ্যাকাউন্ট খোলা থেকে প্রথম ভিডিও সেভ পর্যন্ত, ধাপে ধাপে।',
  steps: [
    {
      title: 'অ্যাক্সেসের অনুরোধ করুন',
      text: 'হোম পেজের ফর্মে “অ্যাক্সেসের অনুরোধ” বেছে নিয়ে নাম আর মোবাইল নম্বর দিন। ইমেইল থাকলে সেটাও দিন (ঐচ্ছিক)।',
    },
    {
      title: 'পাসওয়ার্ড পান',
      text: 'অনুমোদন হলে ইমেইলে, অথবা ইমেইল না দিলে WhatsApp-এ একটি অস্থায়ী পাসওয়ার্ড আসবে। ইমেইলে না পেলে Spam ফোল্ডার দেখুন।',
    },
    {
      title: 'সাইন ইন করুন',
      text: 'ইমেইল বা মোবাইল নম্বর আর পাসওয়ার্ড দিয়ে সাইন ইন করুন। পরে অ্যাকাউন্ট পেজে নিজের পাসওয়ার্ড সেট করে নিন।',
    },
    {
      title: 'লিংক পেস্ট করে ডাউনলোড করুন',
      text: 'ভিডিওর লিংক পেস্ট করে “ভিডিও আনুন” চাপুন, কোয়ালিটি বেছে নিন। ফাইল ফোনের Downloads ফোল্ডারে সেভ হবে।',
    },
  ],
}

/** Download page: using the downloader and the daily count. */
export const DOWNLOAD_TUTORIAL: Tutorial = {
  title: 'কীভাবে ডাউনলোড করবেন',
  description: 'লিংক কপি করা থেকে ফাইল সেভ, আর আজ কতগুলো ডাউনলোড বাকি তা কোথায় দেখবেন।',
  steps: [
    {
      title: 'ভিডিওর লিংক কপি করুন',
      text: 'YouTube, Facebook বা Instagram-এ ভিডিওর Share বাটন চেপে “Copy link” বেছে নিন।',
    },
    {
      title: 'পেস্ট করে “ভিডিও আনুন” চাপুন',
      text: 'কয়েক সেকেন্ডের মধ্যে সব কোয়ালিটি আর প্রতিটির ফাইলের সাইজ দেখাবে।',
    },
    {
      title: 'কোয়ালিটি বেছে ডাউনলোড করুন',
      text: '4K পর্যন্ত ভিডিও, অথবা শুধু অডিও (MP3)। শেষ হলে ফাইল নিজে থেকেই Downloads ফোল্ডারে সেভ হবে।',
    },
    {
      title: 'আজ কতগুলো ডাউনলোড বাকি',
      text: 'পেজের ওপরে ডান কোণে আর লিংক বক্সের কাছের কার্ডে দেখা যায়। দৈনিক সীমা থাকলে তা বাংলাদেশ সময় রাত ১২টায় নতুন করে শুরু হয়।',
    },
  ],
}
