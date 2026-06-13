'use client'
// components/Navbar.tsx
import { Download, Shield, LogOut, User } from 'lucide-react'
import Link from 'next/link'

interface NavbarProps {
  /** If provided, shows user pill + sign-out instead of Admin link */
  userName?: string
  onSignOut?: () => void
}

export default function Navbar({ userName, onSignOut }: NavbarProps) {
  return (
    <header className="relative z-20 border-b border-white/5 bg-[#0d0f1a]/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-[52px] flex items-center justify-between gap-4">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 flex-shrink-0 group">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shadow-sm">
            <Download className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-semibold text-[13px] text-white tracking-tight">
            UniStream<span className="text-sky-400">Saver</span>
          </span>
        </Link>

        {/* Center: phase badge */}
        {/* <div className="phase-badge">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
          Phase 1 Live
        </div> */}

        {/* Right: user controls OR admin link */}
        {userName && onSignOut ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* User pill — hidden on very small screens */}
            <div className="hidden sm:flex items-center gap-1.5 bg-white/5 border border-white/10 px-2.5 py-1.5 rounded-full">
              <User className="w-3 h-3 text-indigo-400 flex-shrink-0" />
              <span className="text-[11px] text-gray-300 font-medium max-w-[110px] truncate">
                {userName}
              </span>
            </div>
            <button
              onClick={onSignOut}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500
                         hover:text-red-400 transition-all duration-150 py-1.5 px-2.5 rounded-lg
                         hover:bg-red-500/10 border border-transparent hover:border-red-500/20"
            >
              <LogOut className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        ) : (
          <Link href="/admin" className="btn-outline flex-shrink-0">
            <Shield className="w-3.5 h-3.5" />
            Admin
          </Link>
        )}
      </div>
    </header>
  )
}