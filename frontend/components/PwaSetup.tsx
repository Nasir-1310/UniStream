'use client'
// components/PwaSetup.tsx
//
// Mounted once in the root layout: registers the service worker that gives
// the installed app its offline page (see public/sw.js and lib/pwa.ts).

import { useEffect } from 'react'
import { registerServiceWorker } from '@/lib/pwa'

export default function PwaSetup() {
  useEffect(() => {
    registerServiceWorker()
  }, [])
  return null
}
