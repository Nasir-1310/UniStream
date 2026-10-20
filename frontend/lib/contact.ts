// frontend/lib/contact.ts
//
// Who to contact for help: shown in the home page's contact section and in
// the footer of every page. Change it here and both update.

export const CONTACT = {
  name: 'UniStream Downloader Team',
  role: 'অ্যাকাউন্ট, ডাউনলোড ও সাবস্ক্রিপশন বিষয়ে সাহায্য',
  /** As people dial it in Bangladesh. */
  whatsapp: '01580-902180',
  /** wa.me wants the international number without + or spaces. */
  whatsappLink: 'https://wa.me/8801580902180',
  email: 'unistreamdownloader.bd@gmail.com',
} as const

export const CONTACT_MAILTO = `mailto:${CONTACT.email}?subject=${encodeURIComponent('UniStream Downloader: সাহায্য দরকার')}`
