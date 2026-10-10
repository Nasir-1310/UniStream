// frontend/lib/serverText.ts
//
// The public site is in Bangla; the API answers in English (its messages are
// also read by the English admin panel, logs and tests). This turns the
// API's messages into Bangla for the public pages. Unknown text is returned
// unchanged, so a new backend message still shows, just in English.
//
// Add a message here when you add one to the backend that users can see.

/** Whole sentences, matched exactly (inside longer messages too). */
const SENTENCES: Record<string, string> = {
  // Session and account
  'Your session has expired. Please sign in again.': 'আপনার সেশন শেষ হয়েছে। আবার সাইন ইন করুন।',
  "Your account is waiting for admin approval. You'll get an email when it's approved.":
    'আপনার অ্যাকাউন্ট অ্যাডমিনের অনুমোদনের অপেক্ষায় আছে। অনুমোদন হলে ইমেইল পাবেন।',
  'Your account has been blocked. Contact the administrator.': 'আপনার অ্যাকাউন্ট ব্লক করা হয়েছে। অ্যাডমিনের সাথে যোগাযোগ করুন।',
  'Incorrect email/phone or password.': 'ইমেইল/মোবাইল নম্বর বা পাসওয়ার্ড ভুল।',
  'Your account has no password yet. Use “Forgot password” to set one.':
    'আপনার অ্যাকাউন্টে এখনো পাসওয়ার্ড সেট করা হয়নি। “পাসওয়ার্ড ভুলে গেছেন?” থেকে পাসওয়ার্ড সেট করুন।',
  'If an approved account uses this email, a reset link is on its way. Check your inbox and spam folder.':
    'এই ইমেইলে কোনো অনুমোদিত অ্যাকাউন্ট থাকলে রিসেট লিংক পাঠানো হচ্ছে। ইনবক্স আর Spam ফোল্ডার দেখুন।',
  'This reset link is invalid or has expired. Request a new one.': 'এই রিসেট লিংকটি ভুল বা মেয়াদোত্তীর্ণ। নতুন লিংক চেয়ে নিন।',
  'This email is already registered. Sign in or reset your password.':
    'এই ইমেইল দিয়ে আগেই রেজিস্ট্রেশন করা আছে। সাইন ইন করুন বা পাসওয়ার্ড রিসেট করুন।',
  'This phone number is already registered. Sign in or reset your password.':
    'এই মোবাইল নম্বর দিয়ে আগেই রেজিস্ট্রেশন করা আছে। সাইন ইন করুন বা পাসওয়ার্ড রিসেট করুন।',
  "Request received. An administrator will review it, and you'll get your password by email once it's approved. Check your spam folder too.":
    'অনুরোধ পাওয়া গেছে। অ্যাডমিন দেখে অনুমোদন দিলে ইমেইলে পাসওয়ার্ড পাবেন। Spam ফোল্ডারও দেখবেন।',
  "Your password has been reset. You're now signed in.": 'আপনার পাসওয়ার্ড রিসেট হয়েছে। আপনি এখন সাইন ইন করা অবস্থায় আছেন।',
  'Your password has been changed. Other devices have been signed out.':
    'আপনার পাসওয়ার্ড বদলানো হয়েছে। অন্য সব ডিভাইস থেকে সাইন আউট করা হয়েছে।',
  'Please enter your password.': 'পাসওয়ার্ড লিখুন।',
  'Please enter your current password.': 'বর্তমান পাসওয়ার্ড লিখুন।',
  'Your current password is incorrect.': 'বর্তমান পাসওয়ার্ড ভুল।',
  'Your new password must be different from your current password.': 'নতুন পাসওয়ার্ড বর্তমান পাসওয়ার্ড থেকে আলাদা হতে হবে।',
  'Please enter a password.': 'একটি পাসওয়ার্ড দিন।',
  'Password must include at least one letter and one number.': 'পাসওয়ার্ডে অন্তত একটি অক্ষর আর একটি সংখ্যা থাকতে হবে।',

  // Validation
  'Please enter your full name.': 'আপনার পুরো নাম লিখুন।',
  'Name contains invalid characters.': 'নামে অগ্রহণযোগ্য অক্ষর আছে।',
  'Name must contain letters.': 'নামে অক্ষর থাকতে হবে।',
  'Please enter your email address.': 'ইমেইল ঠিকানা লিখুন।',
  "Email can't contain spaces.": 'ইমেইলে স্পেস থাকতে পারবে না।',
  'Email is too long.': 'ইমেইল অনেক বড়।',
  'Enter a valid email address, e.g. name@gmail.com.': 'সঠিক ইমেইল ঠিকানা দিন, যেমন name@gmail.com।',
  'Only one @ symbol allowed.': 'শুধু একটি @ চিহ্ন দেওয়া যাবে।',
  'Enter a username before @.': '@-এর আগে ইউজারনেম লিখুন।',
  'Invalid email — check the format.': 'ইমেইল সঠিক নয় — ফরম্যাট দেখে নিন।',
  'Please enter your phone number.': 'মোবাইল নম্বর লিখুন।',
  'Phone number can only contain digits, spaces, dashes and a leading +.':
    'মোবাইল নম্বরে শুধু সংখ্যা, স্পেস, ড্যাশ আর শুরুতে + থাকতে পারে।',
  'Too short — Bangladeshi numbers need 11 digits, e.g. 017XXXXXXXX.': 'খুব ছোট — বাংলাদেশি নম্বরে ১১টি সংখ্যা লাগে, যেমন 017XXXXXXXX।',
  'Too long — Bangladeshi numbers have 11 digits, e.g. 017XXXXXXXX.': 'খুব বড় — বাংলাদেশি নম্বরে ১১টি সংখ্যা থাকে, যেমন 017XXXXXXXX।',
  'Unknown operator — Bangladeshi mobile numbers start with 013–019.': 'অপারেটর চেনা যাচ্ছে না — বাংলাদেশি মোবাইল নম্বর 013–019 দিয়ে শুরু হয়।',
  'Too short — international numbers need 7 to 15 digits after the +.': 'খুব ছোট — আন্তর্জাতিক নম্বরে + এর পর ৭ থেকে ১৫টি সংখ্যা লাগে।',
  'Too long — international numbers have at most 15 digits after the +.': 'খুব বড় — আন্তর্জাতিক নম্বরে + এর পর সর্বোচ্চ ১৫টি সংখ্যা থাকে।',
  'Enter your email address or phone number.': 'ইমেইল বা মোবাইল নম্বর লিখুন।',
  'Enter a valid email address or phone number.': 'সঠিক ইমেইল বা মোবাইল নম্বর দিন।',
  'Please check the details and try again.': 'তথ্যগুলো দেখে আবার চেষ্টা করুন।',
  'This request is too large.': 'অনুরোধটি অনেক বড়।',
  'The request body is not valid JSON.': 'অনুরোধটি সঠিক নয়।',
  'Choose a quality from the list.': 'তালিকা থেকে একটি কোয়ালিটি বেছে নিন।',
  // Checks the pages run before sending (lib/validation.ts)
  'Missing domain — e.g. @gmail.com': 'ডোমেইন নেই — যেমন @gmail.com',
  'Invalid country code — write international numbers as +<country code><number>.':
    'দেশের কোড সঠিক নয় — আন্তর্জাতিক নম্বর লিখুন +<দেশের কোড><নম্বর> এভাবে।',
  'Must start with 01, e.g. 017XXXXXXXX. For numbers outside Bangladesh, add the country code, e.g. +44…':
    '01 দিয়ে শুরু হতে হবে, যেমন 017XXXXXXXX। বিদেশি নম্বর হলে দেশের কোড দিন, যেমন +44…',
  'Please confirm your new password.': 'নতুন পাসওয়ার্ডটি আবার লিখুন।',
  "Passwords don't match.": 'দুটি পাসওয়ার্ড মেলেনি।',
  'Paste a video link first.': 'আগে একটি ভিডিওর লিংক পেস্ট করুন।',
  'Very weak': 'খুব দুর্বল',
  Weak: 'দুর্বল',
  Fair: 'মোটামুটি',
  Good: 'ভালো',
  Strong: 'শক্তিশালী',
  'Avoid common words like "password" or "123456".': '"password" বা "123456"-এর মতো সাধারণ শব্দ এড়িয়ে চলুন।',
  'Avoid repeating the same character.': 'একই অক্ষর বারবার ব্যবহার করবেন না।',
  'Avoid sequences like "abcd" or "1234".': '"abcd" বা "1234"-এর মতো ধারাবাহিক অক্ষর এড়িয়ে চলুন।',
  'Longer is stronger — try 12 or more characters.': 'যত লম্বা, তত শক্তিশালী — ১২ বা তার বেশি অক্ষর দিন।',
  'Mix upper and lower case letters, numbers and symbols.': 'বড় ও ছোট হাতের অক্ষর, সংখ্যা আর চিহ্ন মিলিয়ে দিন।',
  'Please write a few words about it.': 'বিষয়টি নিয়ে কয়েকটা কথা লিখুন।',

  // Links and videos
  'Only YouTube, Facebook and Instagram links are supported.': 'শুধু YouTube, Facebook আর Instagram-এর লিংক চলে।',
  'This link is a playlist or channel. Paste the link of a single video.':
    'এটি প্লেলিস্ট বা চ্যানেলের লিংক। একটি নির্দিষ্ট ভিডিওর লিংক দিন।',
  "This link doesn't point to a video we can download. Open the video itself and copy its link.":
    'এই লিংকে ডাউনলোডযোগ্য ভিডিও নেই। ভিডিওটি খুলে সেটার লিংক কপি করুন।',
  'No downloadable video streams were found.': 'ডাউনলোড করার মতো কোনো ভিডিও পাওয়া যায়নি।',
  "This video has no sound, so it can't be saved as MP3. Download it as MP4 instead.":
    'এই ভিডিওতে কোনো শব্দ নেই, তাই MP3 করা যাবে না। MP4 হিসেবে ডাউনলোড করুন।',
  "YouTube refused our server's request right now. Please try again in a few minutes.":
    'YouTube এই মুহূর্তে আমাদের সার্ভারের অনুরোধ নিচ্ছে না। কয়েক মিনিট পর আবার চেষ্টা করুন।',

  // YouTube notices written for the server owner: visitors get plain words.
  "YouTube is refusing this server's IP address (data-centre IPs such as Render's are blocked), so it offers no HD streams here. Set YOUTUBE_PROXY on the backend to a residential proxy with a sticky session (one exit IP), or run the backend on your own computer, which YouTube serves normally.":
    'YouTube এই মুহূর্তে আমাদের সার্ভারকে HD ভিডিও দিচ্ছে না। কিছুক্ষণ পর আবার চেষ্টা করুন; সমস্যা থেকে গেলে “সমস্যা জানান” দিয়ে আমাদের জানান।',
  "YouTube is refusing the configured YOUTUBE_PROXY too, or the proxy changes its exit IP between requests, which breaks YouTube's IP-bound stream links. Use a residential proxy with a sticky session.":
    'YouTube এই মুহূর্তে আমাদের সার্ভারকে HD ভিডিও দিচ্ছে না। কিছুক্ষণ পর আবার চেষ্টা করুন; সমস্যা থেকে গেলে “সমস্যা জানান” দিয়ে আমাদের জানান।',
  "YouTube's stream-link challenge could not be solved, so its HD streams were skipped. Update yt-dlp and yt-dlp-ejs in requirements.txt and redeploy.":
    'এই মুহূর্তে YouTube থেকে HD কোয়ালিটি আনা যাচ্ছে না। আমরা বিষয়টি দেখছি; কিছুক্ষণ পর আবার চেষ্টা করুন।',
  'This server can get up to 1080p from YouTube. If the video has 1440p or 4K, YouTube serves those only to IPs it trusts: set YOUTUBE_PROXY to a residential proxy with a sticky session, or run the backend on your own computer.':
    'এই ভিডিওটি এখন সর্বোচ্চ 1080p-তে পাওয়া যাচ্ছে।',
  'YouTube is asking this server to confirm it is not a bot. Configure YOUTUBE_COOKIES_BASE64 on the backend with a fresh Netscape-format YouTube cookies.txt export.':
    'YouTube এই মুহূর্তে আমাদের সার্ভারের অনুরোধ যাচাই করছে। কিছুক্ষণ পর আবার চেষ্টা করুন।',
  'YouTube rejected the configured session cookies. Export a fresh youtube.com cookies.txt file and update the server secret.':
    'YouTube এই মুহূর্তে আমাদের সার্ভারের অনুরোধ নিচ্ছে না। কিছুক্ষণ পর আবার চেষ্টা করুন।',
  'Only low resolutions are available because the server has no JavaScript runtime (deno). Redeploy with the packages in requirements.txt installed.':
    'এই মুহূর্তে শুধু কম কোয়ালিটি পাওয়া যাচ্ছে। আমরা বিষয়টি দেখছি; কিছুক্ষণ পর আবার চেষ্টা করুন।',
  'YouTube gives this server only a 360p stream unless it is signed in. Set YOUTUBE_COOKIES_BASE64 on the backend (Render > Environment) to a base64 YouTube cookies.txt export, then redeploy.':
    'এই মুহূর্তে YouTube থেকে শুধু 360p পাওয়া যাচ্ছে। কিছুক্ষণ পর আবার চেষ্টা করুন।',
  'YouTube listed HD streams but refused to send their playlist to this server.': 'YouTube HD ভিডিওর তালিকা দিলেও ফাইল পাঠাতে রাজি হয়নি।',

  // Downloads
  'Downloads are turned off for your account. Contact the administrator.':
    'আপনার অ্যাকাউন্টে ডাউনলোড বন্ধ আছে। অ্যাডমিনের সাথে যোগাযোগ করুন।',
  'Your remaining downloads for today are already in progress.': 'আজকের বাকি ডাউনলোডগুলো এখন চলছে।',
  "You've used your 1 download for today.": 'আজকের ১টি ডাউনলোড ব্যবহার হয়ে গেছে।',
  'Wait for one to finish, then try again.': 'একটি শেষ হলে আবার চেষ্টা করুন।',
  'Too many people are downloading right now. Please try again in a few minutes.':
    'এই মুহূর্তে অনেকে ডাউনলোড করছেন। কয়েক মিনিট পর আবার চেষ্টা করুন।',
  'This download link has expired. Please start the download again.': 'এই ডাউনলোড লিংকের মেয়াদ শেষ। আবার ডাউনলোড শুরু করুন।',
  'This download link has expired or was already used. Please download the video again.':
    'এই ডাউনলোড লিংকের মেয়াদ শেষ বা আগেই ব্যবহার হয়েছে। ভিডিওটি আবার ডাউনলোড করুন।',
  'Downloads are temporarily unavailable. Please try again in a minute.': 'ডাউনলোড সাময়িকভাবে বন্ধ। এক মিনিট পর আবার চেষ্টা করুন।',
  'This download stopped while the page was away (or the server restarted). Please start it again.':
    'পেজটি দীর্ঘক্ষণ বন্ধ থাকায় (বা সার্ভার রিস্টার্ট হওয়ায়) ডাউনলোড থেমে গেছে। আবার শুরু করুন।',
  'The download stopped because part of the stream could not be fetched. Please try again.':
    'ভিডিওর একটি অংশ আনা যায়নি বলে ডাউনলোড থেমে গেছে। আবার চেষ্টা করুন।',

  // Feedback and general
  "Sending feedback isn't available right now. Please try again later.": 'এই মুহূর্তে মতামত পাঠানো যাচ্ছে না। পরে আবার চেষ্টা করুন।',
  'Thanks! Your message reached the UniStream team.': 'ধন্যবাদ! আপনার বার্তা UniStream টিমের কাছে পৌঁছেছে।',
  'Something went wrong on our side. Please try again in a moment.': 'আমাদের দিকে একটি সমস্যা হয়েছে। একটু পর আবার চেষ্টা করুন।',
}

/** Messages with numbers or names in them. */
const PATTERNS: [RegExp, (...groups: string[]) => string][] = [
  [/(\d+) minutes?\b/g, n => `${n} মিনিট`],
  [/Too many requests from your network\. Try again in ([^.]+)\./g, w => `আপনার নেটওয়ার্ক থেকে অনেক বেশি অনুরোধ এসেছে। ${w} পর আবার চেষ্টা করুন।`],
  [/Too many requests, try again in ([^.]+)\./g, w => `অনেক বেশি অনুরোধ। ${w} পর আবার চেষ্টা করুন।`],
  [/Lots of people are getting videos right now\. Please try again in ([^.]+)\./g, w => `এই মুহূর্তে অনেকে ভিডিও আনছেন। ${w} পর আবার চেষ্টা করুন।`],
  [/Too many sign-up requests from your network\. Try again in ([^.]+)\./g, w => `আপনার নেটওয়ার্ক থেকে অনেক রেজিস্ট্রেশন অনুরোধ এসেছে। ${w} পর আবার চেষ্টা করুন।`],
  [/Too many failed sign-in attempts from your network\. Try again in ([^.]+)\./g, w => `আপনার নেটওয়ার্ক থেকে অনেকবার ভুল সাইন ইন হয়েছে। ${w} পর আবার চেষ্টা করুন।`],
  [/Too many sign-in attempts\. Try again in ([^,]+), or reset your password\./g, w => `অনেকবার সাইন ইনের চেষ্টা হয়েছে। ${w} পর আবার চেষ্টা করুন, অথবা পাসওয়ার্ড রিসেট করুন।`],
  [/Too many password reset requests\. Try again in ([^.]+)\./g, w => `অনেকবার পাসওয়ার্ড রিসেটের অনুরোধ হয়েছে। ${w} পর আবার চেষ্টা করুন।`],
  [/Too many password reset attempts\. Try again in ([^.]+)\./g, w => `অনেকবার পাসওয়ার্ড রিসেটের চেষ্টা হয়েছে। ${w} পর আবার চেষ্টা করুন।`],
  [/Too many password change attempts\. Try again in ([^.]+)\./g, w => `অনেকবার পাসওয়ার্ড বদলের চেষ্টা হয়েছে। ${w} পর আবার চেষ্টা করুন।`],
  [/Too many download attempts\. Try again in ([^.]+)\./g, w => `অনেকবার ডাউনলোডের চেষ্টা হয়েছে। ${w} পর আবার চেষ্টা করুন।`],
  [/You've sent a lot of reports this hour\. Try again in ([^.]+)\./g, w => `এই ঘণ্টায় অনেক বার্তা পাঠিয়েছেন। ${w} পর আবার চেষ্টা করুন।`],
  [/Your limit resets at ([^.]+?)\./g, t => `আপনার সীমা আবার চালু হবে ${t}-এ।`],
  [/You've used all (\d+) downloads for today\./g, n => `আজকের ${n}টি ডাউনলোডই ব্যবহার হয়ে গেছে।`],
  [/You already have (\d+) downloads in progress\./g, n => `আপনার ${n}টি ডাউনলোড এখন চলছে।`],
  [/YouTube did not provide the (\d+)p stream for this download\. Try again, or choose another resolution\./g,
    h => `YouTube এই ডাউনলোডের জন্য ${h}p দেয়নি। আবার চেষ্টা করুন, অথবা অন্য কোয়ালিটি বেছে নিন।`],
  [/Name must be at least (\d+) characters\./g, n => `নাম অন্তত ${n} অক্ষরের হতে হবে।`],
  [/Name must be at most (\d+) characters\./g, n => `নাম সর্বোচ্চ ${n} অক্ষরের হতে পারে।`],
  [/Password must be at least (\d+) characters\./g, n => `পাসওয়ার্ড অন্তত ${n} অক্ষরের হতে হবে।`],
  [/Password must be at most (\d+) characters\./g, n => `পাসওয়ার্ড সর্বোচ্চ ${n} অক্ষরের হতে পারে।`],
  [/Unexpected field: ([^.]+)\./g, f => `অপ্রত্যাশিত তথ্য: ${f}।`],
  [/^Use at least (\d+) characters\.$/g, n => `অন্তত ${n}টি অক্ষর দিন।`],
  // Common yt-dlp answers that reach the page unchanged.
  [/.*\bPrivate video\b.*/gi, () => 'এটি একটি প্রাইভেট ভিডিও। শুধু পাবলিক ভিডিও ডাউনলোড করা যায়।'],
  [/.*\b(?:Video unavailable|This video is (?:not available|unavailable))\b.*/gi, () => 'ভিডিওটি পাওয়া যাচ্ছে না (মুছে ফেলা হয়েছে বা আপনার এলাকায় বন্ধ)।'],
  [/.*\bSign in to confirm your age\b.*/gi, () => 'এই ভিডিওতে বয়সসীমা দেওয়া আছে, তাই ডাউনলোড করা যাচ্ছে না।'],
  [/.*\b(?:members-only|Join this channel)\b.*/gi, () => 'এটি মেম্বারশিপ-অনলি ভিডিও, তাই ডাউনলোড করা যাচ্ছে না।'],
]

/** Bangla for a check's error (null stays null), for the public pages. */
export function bnError(message: string | null | undefined): string | null {
  return message ? translateServerText(message) : null
}

/** True on the public (Bangla) site, false in the English admin panel. */
export function isBanglaPage(): boolean {
  return typeof document === 'undefined' || document.documentElement.dataset.theme !== 'dark'
}

/** Bangla for an API message; unknown text comes back unchanged. */
export function translateServerText(text: string | null | undefined): string {
  if (!text) return ''
  let result = text.trim()
  if (SENTENCES[result]) return SENTENCES[result]
  for (const [pattern, replace] of PATTERNS) {
    result = result.replace(pattern, (_match, ...groups: unknown[]) =>
      replace(...groups.filter((g): g is string => typeof g === 'string')),
    )
  }
  for (const [english, bangla] of Object.entries(SENTENCES)) {
    if (result.includes(english)) result = result.split(english).join(bangla)
  }
  // "Could not fetch video info: <reason>" wraps the reason the page shows.
  return result.replace(/^Could not fetch video info:\s*/i, 'ভিডিওর তথ্য আনা যায়নি: ')
}
