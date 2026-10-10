// frontend/lib/contact.ts
//
// Who to contact for help: shown in the home page's contact section and in
// the footer of every page. Change it here and both update.

export const CONTACT = {
  name: 'Md Nasir Uddin',
  role: 'সফটওয়্যার ইঞ্জিনিয়ারিং (IIT), ঢাকা বিশ্ববিদ্যালয়',
  roleShort: 'Software Engineering (IIT), DU',
  /** As people dial it in Bangladesh. */
  whatsapp: '01580-902180',
  /** wa.me wants the international number without + or spaces. */
  whatsappLink: 'https://wa.me/8801580902180',
  email: 'nasir.iit.du@gmail.com',
} as const

export const CONTACT_MAILTO = `mailto:${CONTACT.email}?subject=${encodeURIComponent('UniStream Saver: সাহায্য দরকার')}`
